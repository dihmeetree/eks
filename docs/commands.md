## Allow Root Access To Cluster (Gives UI access)
aws eks associate-access-policy --cluster-name scale --principal-arn arn:aws:iam::952189540537:root --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy --access-scope type=cluster

## Set Cloudflare API Token
pulumi config set --secret cloudflare:apiToken <YOUR_API_TOKEN>

## Create KubeConfig for kubectl
aws eks update-kubeconfig --name scale --region us-east-1