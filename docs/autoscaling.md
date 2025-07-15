# Autoscaling and Zero-Downtime Deployments in EKS

This document outlines the configuration required to achieve both automatic scaling of pods and zero-downtime deployments for an application running on Amazon EKS. We will use a simple Nginx deployment as an example.

## 1. Horizontal Pod Autoscaling (HPA)

Horizontal Pod Autoscaling automatically scales the number of pods in a deployment based on observed CPU utilization or other select metrics.

### Requirements:

*   **Metrics Server**: The HPA needs a source for metrics. The `metrics-server` is a common choice and can be installed as an EKS Addon.
*   **Resource Requests**: Pods in the deployment *must* have CPU resource requests defined in their spec. The HPA uses this value to calculate the utilization percentage.

### HPA Configuration:

We configure an `HorizontalPodAutoscaler` resource to target our Nginx deployment. It will increase the number of pods whenever the average CPU utilization across all pods exceeds 70%.

```typescript
// src/index.ts

const hpa = new k8s.autoscaling.v2.HorizontalPodAutoscaler(
  appName,
  {
    // ...
    spec: {
      scaleTargetRef: {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        name: deployment.metadata.name
      },
      minReplicas: 3,
      maxReplicas: 100,
      metrics: [
        {
          type: 'Resource',
          resource: {
            name: 'cpu',
            target: {
              type: 'Utilization',
              averageUtilization: 70
            }
          }
        }
      ]
    }
  },
  { provider: cluster.provider, dependsOn: [deployment, metricsServer] }
);
```

## 2. Achieving Zero-Downtime Deployments

When you update a deployment in Kubernetes, the default behavior can cause a brief period of downtime. This happens because old pods might be terminated before new pods are ready to serve traffic, or because the load balancer hasn't updated its routing yet.

To prevent this, we need a multi-layered approach involving deployment strategies, health checks, and load balancer configuration.

### Step 1: Rolling Update Strategy

The first step is to configure the deployment's `strategy` to ensure that there are always enough healthy pods available to serve traffic during an update.

*   `type: 'RollingUpdate'`: Specifies the update strategy.
*   `maxSurge`: The maximum number of pods that can be created over the desired number of pods. `100%` is aggressive and allows for faster rollouts by doubling the number of pods temporarily.
*   `maxUnavailable`: The maximum number of pods that can be unavailable during the update. Setting this to `0` is critical for zero-downtime as it ensures that your application's capacity is never reduced.

```typescript
// src/index.ts (inside Deployment spec)

      strategy: {
        type: 'RollingUpdate',
        rollingUpdate: {
          maxSurge: '100%', // Allow 100% more pods during update for faster rollouts
          maxUnavailable: 0 // Never allow any pods to be unavailable
        }
      },
```

### Step 2: Container Health Checks

Health checks tell Kubernetes whether a pod is ready to receive traffic (`readinessProbe`) or if it's unhealthy and needs to be restarted (`livenessProbe`).

*   **`readinessProbe`**: Kubernetes will not route traffic to a pod until this probe succeeds. This is essential to prevent traffic from being sent to a pod that is still starting up.
*   **`livenessProbe`**: If this probe fails, Kubernetes will kill the container and restart it. This helps recover from deadlocks or unresponsive application states.

```typescript
// src/index.ts (inside container spec)

              readinessProbe: {
                httpGet: {
                  path: '/',
                  port: 80
                },
                initialDelaySeconds: 2,
                periodSeconds: 3,
                timeoutSeconds: 2,
                successThreshold: 1,
                failureThreshold: 2
              },
              livenessProbe: {
                httpGet: {
                  path: '/',
                  port: 80
                },
                initialDelaySeconds: 15,
                periodSeconds: 10,
                timeoutSeconds: 3,
                successThreshold: 1,
                failureThreshold: 3
              },
```

### Step 3: Aligning with the AWS Application Load Balancer (ALB)

When using the AWS Load Balancer Controller, the ALB has its own health checks and lifecycle rules. It's crucial to align these with Kubernetes' settings.

We use annotations on the `Ingress` resource to configure the ALB's behavior.

*   **ALB Health Checks**: These annotations configure the health checks performed by the ALB target group. They should be slightly less aggressive than the pod's readiness probe to ensure the ALB marks the pod as healthy.
*   **Connection Draining (`deregistration_delay`)**: This is a critical setting. It tells the ALB to wait for a specified duration (e.g., 30 seconds) before it finishes deregistering a pod. This allows any in-flight requests to complete successfully instead of being abruptly cut off.

```typescript
// src/index.ts (inside Ingress metadata annotations)

        'alb.ingress.kubernetes.io/healthcheck-path': '/',
        'alb.ingress.kubernetes.io/healthcheck-interval-seconds': '10',
        'alb.ingress.kubernetes.io/healthcheck-timeout-seconds': '5',
        'alb.ingress.kubernetes.io/healthy-threshold-count': '2',
        'alb.ingress.kubernetes.io/unhealthy-threshold-count': '3',
        'alb.ingress.kubernetes.io/target-group-attributes': 'deregistration_delay.timeout_seconds=30'
```

### Step 4: Solving the Final Race Condition with `preStop` Hook

Even with all the above configurations, a subtle race condition can still cause "502 Bad Gateway" errors.

1.  A pod is told to terminate.
2.  The pod's endpoint is removed from the Kubernetes service. The ALB is notified to start deregistering the pod.
3.  The `nginx` process inside the container receives the termination signal (`SIGTERM`) and shuts down *immediately*.
4.  For a brief moment, the ALB might still send a request to the pod *after* Nginx has shut down but *before* the deregistration is complete. This results in a 502 error.

To solve this, we use a `preStop` lifecycle hook.

*   **`preStop` hook**: This hook executes a command *before* the container is sent the termination signal. We add a `sleep 20` command. This forces the pod to wait for 20 seconds before it starts shutting down.
*   **`terminationGracePeriodSeconds`**: This is the total time a pod has to shut down. It must be longer than the `preStop` sleep time plus the ALB's deregistration delay.

This pause gives the ALB more than enough time to complete the deregistration process and stop sending traffic to the pod *before* the Nginx process shuts down.

```typescript
// src/index.ts (inside Pod spec)

          terminationGracePeriodSeconds: 45,
          containers: [
            {
// ... container spec ...
              lifecycle: {
                preStop: {
                  exec: {
                    command: ['/bin/sh', '-c', 'sleep 20']
                  }
                }
              },
// ...
            }
          ]
```

By combining these four strategies, we create a robust system that can automatically scale based on demand and perform deployments with zero user-facing downtime. 