import * as pulumi from '@pulumi/pulumi'
import * as awsx from '@pulumi/awsx'
import * as eks from '@pulumi/eks'
import * as k8s from '@pulumi/kubernetes'
import { SubnetType } from '@pulumi/awsx/ec2'

const config = new pulumi.Config()
const clusterName = config.require('clusterName')

const eksVpc = new awsx.ec2.Vpc('eks-auto-mode', {
  enableDnsHostnames: true,
  cidrBlock: '10.0.0.0/16',
  subnetSpecs: [
    // Necessary tags for EKS Auto Mode to identify the subnets for the load balancers.
    // See: https://kubernetes-sigs.github.io/aws-load-balancer-controller/v2.1/deploy/subnet_discovery/
    {
      type: SubnetType.Public,
      tags: {
        [`kubernetes.io/cluster/${clusterName}`]: 'shared',
        'kubernetes.io/role/elb': '1'
      }
    },
    {
      type: SubnetType.Private,
      tags: {
        [`kubernetes.io/cluster/${clusterName}`]: 'shared',
        'kubernetes.io/role/internal-elb': '1'
      }
    }
  ],
  subnetStrategy: 'Auto'
})

const cluster = new eks.Cluster('eks-auto-mode', {
  name: clusterName,
  // EKS Auto Mode requires Access Entries, use either the `Api` or `ApiAndConfigMap` authentication mode.
  authenticationMode: eks.AuthenticationMode.Api,
  vpcId: eksVpc.vpcId,
  publicSubnetIds: eksVpc.publicSubnetIds,
  privateSubnetIds: eksVpc.privateSubnetIds,
  // Enables compute, storage and load balancing for the cluster.
  autoMode: {
    enabled: true
  }
})

const appName = 'nginx'
const ns = new k8s.core.v1.Namespace(
  appName,
  {
    metadata: { name: appName }
  },
  { provider: cluster.provider }
)

// Install metrics server via EKS Addon
const metricsServer = new eks.Addon('metrics-server', {
  cluster,
  addonName: 'metrics-server',
  addonVersion: 'v0.8.0-eksbuild.1'
})

const configMap = new k8s.core.v1.ConfigMap(
  appName,
  {
    metadata: {
      namespace: ns.metadata.name
    },
    data: {
      'index.html': '<html><body>Hello, World!</body></html>'
    }
  },
  { provider: cluster.provider }
)

const deployment = new k8s.apps.v1.Deployment(
  appName,
  {
    metadata: {
      namespace: ns.metadata.name
    },
    spec: {
      selector: { matchLabels: { app: appName } },
      replicas: 3, // Reduced initial replicas since HPA will manage this
      strategy: {
        type: 'RollingUpdate',
        rollingUpdate: {
          maxSurge: '100%', // Allow 100% more pods during update for faster rollouts
          maxUnavailable: 0 // Never allow any pods to be unavailable
        }
      },
      template: {
        metadata: { labels: { app: appName } },
        spec: {
          terminationGracePeriodSeconds: 45,
          containers: [
            {
              name: appName,
              image: appName,
              ports: [{ containerPort: 80 }],
              // Add resource requests for HPA to work
              resources: {
                requests: {
                  cpu: '100m',
                  memory: '128Mi'
                },
                limits: {
                  cpu: '200m',
                  memory: '256Mi'
                }
              },
              // Add health checks for zero-downtime deployments
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
              lifecycle: {
                preStop: {
                  exec: {
                    command: ['/bin/sh', '-c', 'sleep 20']
                  }
                }
              },
              volumeMounts: [
                { name: 'nginx-index', mountPath: '/usr/share/nginx/html' }
              ]
            }
          ],
          volumes: [
            {
              name: 'nginx-index',
              configMap: { name: configMap.metadata.name }
            }
          ]
        }
      }
    }
  },
  { provider: cluster.provider }
)

// Add HorizontalPodAutoscaler for automatic scaling
const hpa = new k8s.autoscaling.v2.HorizontalPodAutoscaler(
  appName,
  {
    metadata: {
      namespace: ns.metadata.name
    },
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
)

const service = new k8s.core.v1.Service(
  appName,
  {
    metadata: {
      name: appName,
      namespace: ns.metadata.name
    },
    spec: {
      selector: { app: appName },
      ports: [{ port: 80, targetPort: 80 }]
    }
  },
  { provider: cluster.provider, dependsOn: [deployment] }
)

const ingressClass = new k8s.networking.v1.IngressClass(
  'alb',
  {
    metadata: {
      namespace: ns.metadata.name,
      labels: {
        'app.kubernetes.io/name': 'LoadBalancerController'
      },
      name: 'alb'
    },
    spec: {
      controller: 'eks.amazonaws.com/alb'
    }
  },
  { provider: cluster.provider }
)

const ingress = new k8s.networking.v1.Ingress(
  appName,
  {
    metadata: {
      namespace: ns.metadata.name,
      // Annotations for EKS Auto Mode to identify the Ingress as internet-facing and target-type as IP.
      annotations: {
        'alb.ingress.kubernetes.io/scheme': 'internet-facing',
        'alb.ingress.kubernetes.io/target-type': 'ip',
        // Add HTTPS support with custom certificate
        'alb.ingress.kubernetes.io/listen-ports':
          '[{"HTTP": 80}, {"HTTPS": 443}]',
        'alb.ingress.kubernetes.io/certificate-arn':
          'arn:aws:acm:us-east-1:952189540537:certificate/7d0a60af-5780-400b-97cf-cdf55d3602b8',
        // Optional: Redirect HTTP to HTTPS
        'alb.ingress.kubernetes.io/ssl-redirect': '443',
        // ALB health check configuration for smooth rolling updates
        'alb.ingress.kubernetes.io/healthcheck-path': '/',
        'alb.ingress.kubernetes.io/healthcheck-interval-seconds': '10',
        'alb.ingress.kubernetes.io/healthcheck-timeout-seconds': '5',
        'alb.ingress.kubernetes.io/healthy-threshold-count': '2',
        'alb.ingress.kubernetes.io/unhealthy-threshold-count': '3',
        // Connection draining settings for zero-downtime deployments
        'alb.ingress.kubernetes.io/target-group-attributes':
          'deregistration_delay.timeout_seconds=30'
      }
    },
    spec: {
      ingressClassName: ingressClass.metadata.name,
      rules: [
        {
          http: {
            paths: [
              {
                path: '/',
                pathType: 'Prefix',
                backend: {
                  service: {
                    name: service.metadata.name,
                    port: {
                      number: 80
                    }
                  }
                }
              }
            ]
          }
        }
      ]
    }
  },
  { provider: cluster.provider }
)

export const url = ingress.status.apply(
  (status) => status?.loadBalancer?.ingress?.[0]?.hostname
)
