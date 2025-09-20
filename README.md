# EKS Auto Mode Infrastructure

Production-ready AWS EKS cluster with Auto Mode, managed Prometheus/Grafana monitoring, and zero-downtime deployments using Pulumi TypeScript.

## 🏗️ Architecture Overview

This project deploys a comprehensive EKS infrastructure with:

- **EKS Auto Mode Cluster**: Fully managed compute, storage, and load balancing
- **Custom VPC**: Properly configured subnets with EKS Auto Mode tags
- **Observability Stack**: AWS Managed Prometheus + Grafana with automated scraping
- **Sample Application**: Production-ready NGINX with autoscaling and zero-downtime deployments
- **Database Integration**: PlanetScale connectivity via AWS PrivateLink
- **SSL/DNS**: HTTPS-enabled ALB with Cloudflare DNS management

## 📋 Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/get-started/install/)
- [AWS CLI](https://aws.amazon.com/cli/) configured with appropriate permissions
- [Node.js](https://nodejs.org/) 18+ and [Bun](https://bun.sh/)
- AWS account with EKS, VPC, IAM, and monitoring service permissions

## 🚀 Quick Start

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd eks
bun install
```

### 2. Configure Pulumi Stack

```bash
# Initialize a new stack (or use existing)
pulumi stack init new

# Set required configuration
pulumi config set eks:clusterName scale
pulumi config set eks:region us-east-1
pulumi config set cloudflare:apiToken <your-cloudflare-token> --secret
```

### 3. Deploy Infrastructure

```bash
# Preview changes
pulumi preview

# Deploy the stack
pulumi up
```

### 4. Access Your Application

After deployment, get the application URL:

```bash
pulumi stack output url
```

## 📊 Monitoring & Observability

### AWS Managed Prometheus (AMP)
- **Workspace**: Automatically created with cluster name prefix
- **Scraping**: Pre-configured for EKS API server, nodes, and pods
- **Metrics**: Comprehensive cluster and application metrics

### AWS Managed Grafana (AMG)
- **Authentication**: AWS SSO integration
- **Data Source**: Connected to AMP workspace
- **Access**: Use the workspace URL from stack outputs

```bash
# Get monitoring endpoints
pulumi stack output prometheusWorkspaceUrl
pulumi stack output grafanaWorkspaceUrl
```

## 🔧 Application Features

### NGINX Sample Application
- **Replicas**: 3 minimum, scales up to 100 based on CPU/memory
- **Health Checks**: Readiness and liveness probes configured
- **Rolling Updates**: Zero-downtime deployments with proper draining
- **Persistent Storage**: EBS CSI with encrypted GP3 volumes

### Auto Scaling
- **HPA**: Horizontal Pod Autoscaler based on CPU (60%) and memory (60%)
- **Target**: Maintains optimal resource utilization
- **Metrics Server**: Deployed via EKS addon

## 🗂️ Project Structure

```
├── src/
│   └── index.ts          # Main infrastructure code
├── docs/
│   ├── autoscaling.md    # Autoscaling documentation
│   └── commands.md       # Useful commands
├── Pulumi.yaml           # Pulumi project configuration
├── Pulumi.new.yaml       # Stack-specific configuration
├── package.json          # Dependencies
└── tsconfig.json         # TypeScript configuration
```

## 🛠️ Infrastructure Components

### Networking
- **VPC**: Custom VPC with public/private subnets
- **Security Groups**: Configured for PlanetScale VPC endpoint
- **Load Balancer**: Application Load Balancer with SSL termination

### Storage
- **Storage Class**: EBS CSI with GP3 encryption
- **Persistent Volumes**: Automatic provisioning for stateful workloads

### Security
- **IAM Roles**: Least privilege access for Grafana and EKS
- **Network Policies**: VPC endpoint security groups
- **Encryption**: EBS volumes encrypted at rest

## 📖 Useful Commands

```bash
# Get cluster credentials
aws eks update-kubeconfig --region us-east-1 --name scale

# View pods
kubectl get pods -n nginx

# Check HPA status
kubectl get hpa -n nginx

# View persistent volumes
kubectl get pv,pvc -n nginx

# Check ingress status
kubectl get ingress -n nginx
```

## 🔍 Troubleshooting

### Common Issues

1. **Ingress not accessible**: Check ALB security groups and target group health
2. **Pods not scaling**: Verify metrics-server is running and HPA configuration
3. **Storage issues**: Check storage class and PVC status
4. **Monitoring gaps**: Verify Prometheus scraper configuration and IAM permissions

### Debug Commands

```bash
# Check cluster status
pulumi stack output

# View EKS cluster details
aws eks describe-cluster --name scale --region us-east-1

# Check node status
kubectl get nodes -o wide

# View events
kubectl get events --sort-by='.lastTimestamp' -n nginx
```

## 🧹 Cleanup

To destroy all resources:

```bash
pulumi destroy
```

⚠️ **Warning**: This will permanently delete all resources including data stored in persistent volumes.

## 📚 Additional Documentation

- [Autoscaling Guide](./docs/autoscaling.md)
- [Command Reference](./docs/commands.md)
- [Pulumi EKS Documentation](https://www.pulumi.com/registry/packages/eks/)
- [EKS Auto Mode Documentation](https://docs.aws.amazon.com/eks/latest/userguide/auto-mode.html)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with `pulumi preview`
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🔗 Outputs

After deployment, the following outputs are available:

| Output | Description |
|--------|-------------|
| `url` | Application load balancer hostname |
| `prometheusWorkspaceUrl` | AWS Managed Prometheus endpoint |
| `grafanaWorkspaceUrl` | AWS Managed Grafana workspace URL |
| `prometheusWorkspaceId` | AMP workspace identifier |
| `grafanaWorkspaceId` | AMG workspace identifier |
| `prometheusScraperId` | Prometheus scraper configuration ID |
| `grafanaApiKey` | Grafana API key for programmatic access |