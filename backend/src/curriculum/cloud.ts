import { type DistrictDef, roadmap, docs, course } from "./types.js";

const DEVOPS = roadmap("roadmap.sh — DevOps", "https://roadmap.sh/devops");
const AWSRM = roadmap("roadmap.sh — AWS", "https://roadmap.sh/aws");

export const cloud: DistrictDef = {
  slug: "cl",
  name: "Cloud Engineering",
  subtitle: "Run the product on managed infrastructure",
  layer: 3,
  color: "#7fa3a1",
  cols: 4,
  goal: "Deploy something like the capstone, understand the infrastructure, diagnose common failures and explain the cost and security trade-offs.",
  note: "You don't need to become a Kubernetes specialist. Learn to deploy and operate a basic application. Start the capstone simple and add services only when you need them.",
  topics: [
    {
      slug: "cl.linux", name: "Linux and networking", priority: "CORE", hours: 12,
      description: "The operating system and network every server runs on.",
      subtopics: ["Shell, processes and services", "Permissions and environment variables", "IP addresses, ports and DNS", "HTTP/HTTPS and TLS certificates", "Firewalls, proxies and reverse proxies", "SSH"],
      exercise: "Provision a Linux VM, harden SSH, run an app behind Nginx as a reverse proxy with a TLS certificate.",
      resources: [roadmap("roadmap.sh — Linux", "https://roadmap.sh/linux"), course("Linux Journey", "https://linuxjourney.com/"), DEVOPS],
    },
    {
      slug: "cl.docker", name: "Docker", priority: "CORE", hours: 10,
      description: "Packaging applications as images and running them as containers. You already use it for Engineering City.",
      subtopics: ["Images and containers", "Dockerfiles and layers", "Volumes and networks", "Docker Compose", "Multi-stage builds and image size"],
      exercise: "Explain every line of Engineering City's Dockerfiles and compose file, then cut the backend image size by a measurable amount.",
      resources: [docs("Docker — Get started", "https://docs.docker.com/get-started/"), docs("Docker Compose", "https://docs.docker.com/compose/"), roadmap("roadmap.sh — Docker", "https://roadmap.sh/docker")],
    },
    {
      slug: "cl.concepts", name: "Cloud concepts", priority: "CORE", hours: 6,
      description: "The mental model of cloud computing before any specific provider.",
      subtopics: ["IaaS, PaaS and SaaS", "Regions and availability zones", "Shared responsibility model", "Pricing and cost drivers"],
      exercise: "Estimate the monthly cost of hosting your capstone in two different ways using the AWS pricing calculator.",
      resources: [docs("AWS — Shared responsibility model", "https://aws.amazon.com/compliance/shared-responsibility-model/"), course("AWS Skill Builder — Cloud Essentials", "https://skillbuilder.aws"), AWSRM],
    },
    {
      slug: "cl.aws", name: "AWS core services", priority: "CORE", hours: 18,
      description: "The handful of AWS services that run most web applications.",
      subtopics: ["IAM identities and policies", "EC2 virtual machines", "VPC networking", "S3 object storage", "RDS managed PostgreSQL", "Load balancers and ECR", "ECS container runtime", "CloudWatch logs and metrics"],
      exercise: "Deploy a containerised API to ECS behind a load balancer, connected to RDS, with least-privilege IAM roles.",
      resources: [docs("AWS IAM — User guide", "https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html"), docs("Amazon VPC — User guide", "https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html"), docs("Amazon ECS — Developer guide", "https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html"), AWSRM],
      dependsOn: ["cl.docker", "cl.concepts"],
    },
    {
      slug: "cl.cicd", name: "CI/CD", priority: "CORE", hours: 10,
      description: "Automating build, test and deployment so every change ships the same way.",
      subtopics: ["GitHub Actions workflows", "Build and test pipelines", "Publishing Docker images", "Secrets and environments", "Automated deployment and rollback"],
      exercise: "Build a GitHub Actions pipeline that tests, builds and pushes an image, then deploys it, with a documented rollback.",
      resources: [docs("GitHub Actions documentation", "https://docs.github.com/en/actions"), DEVOPS],
      dependsOn: ["cl.docker"],
    },
    {
      slug: "cl.k8s", name: "Kubernetes basics", priority: "IMPORTANT", hours: 10,
      description: "Enough Kubernetes to read manifests and deploy a small app. Not specialist depth.",
      subtopics: ["Clusters, nodes and pods", "Deployments and services", "ConfigMaps and secrets", "Ingress", "Health checks, resources and scaling"],
      exercise: "Deploy a two-service app on a local cluster (kind or minikube) with probes, resource limits and an ingress.",
      resources: [docs("Kubernetes Basics tutorial", "https://kubernetes.io/docs/tutorials/kubernetes-basics/"), roadmap("roadmap.sh — Kubernetes", "https://roadmap.sh/kubernetes")],
      dependsOn: ["cl.docker"],
    },
    {
      slug: "cl.operations", name: "Production operations", priority: "CORE", hours: 8,
      description: "Keeping a deployed app healthy: monitoring, alerting, backups, security and cost.",
      subtopics: ["Monitoring and alerting", "Backups and recovery", "Security and IAM hygiene", "Cost management"],
      exercise: "Write a runbook for your deployed capstone: alarms, a restore drill you actually performed, and a monthly cost review.",
      resources: [docs("AWS Well-Architected Framework", "https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html"), DEVOPS],
      dependsOn: ["cl.aws"],
    },
    {
      slug: "cl.capstone", name: "Capstone deployment", priority: "CORE", hours: 16,
      description: "Deploy a full-stack app end to end: frontend, API, database, storage, pipeline and monitoring. An example architecture, not a requirement to use every service.",
      subtopics: ["Frontend with domain, DNS and TLS", "API in containers on AWS", "PostgreSQL on RDS", "File storage on S3", "Pipeline and monitoring"],
      exercise: "Have the capstone running publicly with HTTPS, deployed by your pipeline, with a CloudWatch dashboard, and tear-down documented.",
      resources: [docs("AWS — Getting started", "https://aws.amazon.com/getting-started/"), AWSRM],
      dependsOn: ["cl.aws", "cl.cicd"],
    },
    {
      slug: "cl.iac", name: "Infrastructure as code", priority: "OPTIONAL", hours: 8,
      description: "Describing infrastructure in version-controlled files instead of console clicks.",
      subtopics: ["Terraform basics", "State and modules", "Plan and apply workflow"],
      exercise: "Recreate the capstone's network and database with Terraform.",
      resources: [docs("Terraform — Tutorials", "https://developer.hashicorp.com/terraform/tutorials")],
      dependsOn: ["cl.aws"],
    },
  ],
};
