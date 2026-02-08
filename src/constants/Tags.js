import Terraform from "../icons/Terraform.astro";
import Aws from "../icons/Aws.astro";
import Python from "../icons/Python.astro";
import GNUBash from "../icons/GNUBash.astro";
import Go from "../icons/Go.astro";
import Kubernetes from "../icons/Kubernetes.astro";
import Istio from "../icons/istio.astro";
import GitLab from "../icons/GitLab.astro";
import Jenkins from "../icons/jenkins.astro";
import Prometheus from "../icons/Prometheus.astro";
import Grafana from "../icons/Grafana.astro";
import Datadog from "../icons/datadog.astro";
import Sumologic from "../icons/Sumologic.astro";
import Helm from "../icons/Helm.astro";
import Slack from "../icons/Slack.astro";
import Pagerduty from "../icons/pagerduty.astro";
import Flexibility from "../icons/Flexibility.astro";
import Team from "../icons/Team.astro";
import Iniciative from "../icons/Iniciative.astro";
import Critic from "../icons/Critic.astro";
import ProblemResolution from "../icons/ProblemResolution.astro";
import Learn from "../icons/Learn.astro";
import Git from "../icons/Git.astro";
import GitHub from "../icons/GitHub.astro";
import Linux from "../icons/Linux.astro";
import Docker from "../icons/Docker.astro";
import Cpp from "../icons/Cpp.astro";
import DigitalOcean from "../icons/DigitalOcean.astro";
import Cloudflare from "../icons/Cloudflare.astro";

export const TAGS = {
  // DevOps & Infrastructure
  TERRAFORM: { name: "Terraform", icon: Terraform },
  AWS: { name: "Amazon Web Services", icon: Aws },
  KUBERNETES: { name: "Kubernetes", icon: Kubernetes },
  ISTIO: { name: "Istio (Service Mesh)", icon: Istio },
  HELM: { name: "Helm", icon: Helm },
  DOCKER: { name: "Docker", icon: Docker },
  DIGITALOCEAN: { name: "DigitalOcean", icon: DigitalOcean },
  CLOUDFLARE: { name: "Cloudflare", icon: Cloudflare },
  
  // CI/CD & Monitoring
  GITLAB: { name: "GitLab Pipelines", icon: GitLab },
  JENKINS: { name: "Jenkins", icon: Jenkins },
  PROMETHEUS: { name: "Prometheus", icon: Prometheus },
  GRAFANA: { name: "Grafana", icon: Grafana },
  DATADOG: { name: "Datadog", icon: Datadog },
  SUMOLOGIC: { name: "Sumologic", icon: Sumologic },
  PAGERDUTY: { name: "PagerDuty", icon: Pagerduty },
  
  // Programming Languages
  PYTHON: { name: "Python", icon: Python },
  GO: { name: "Go", icon: Go },
  BASH: { name: "Bash - Zsh", icon: GNUBash },
  CPP: { name: "C++", icon: Cpp },
  
  // Communication & Collaboration
  SLACK: { name: "Slack Workflows", icon: Slack },
  
  // Soft Skills
  FLEXIBILITY: { name: "Flexibility and Adaptability", icon: Flexibility },
  TEAMWORK: { name: "Teamwork", icon: Team },
  INITIATIVE: { name: "Proactivity", icon: Iniciative },
  CRITIC: { name: "Critical Thinking", icon: Critic },
  PROBLEMRES: { name: "Problem Solving", icon: ProblemResolution },
  LEARN: { name: "Always Learning", icon: Learn },
  
  // Version Control
  GIT: { name: "Git", icon: Git },
  GITHUB: { name: "Github", icon: GitHub },
  
  // System Administration
  LINUX: { name: "Linux", icon: Linux },
};
