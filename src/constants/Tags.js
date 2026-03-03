// Local icon components (no CDN equivalent or CDN broken)
import Aws from "../icons/Aws.astro";
import SlackIcon from "../icons/Slack.astro";
import Flexibility from "../icons/Flexibility.astro";
import Team from "../icons/Team.astro";
import Iniciative from "../icons/Iniciative.astro";
import Critic from "../icons/Critic.astro";
import ProblemResolution from "../icons/ProblemResolution.astro";
import Learn from "../icons/Learn.astro";

// Simple Icons CDN base URL (serves SVGs in any color)
const si = (slug) => `https://cdn.simpleicons.org/${slug}/white`;

// Helpers to create consistent tag shapes (both fields always present)
const cdn = (name, slug) => ({ name, iconUrl: si(slug), icon: null });
const local = (name, icon) => ({ name, iconUrl: null, icon });

export const TAGS = {
  // DevOps & Infrastructure
  TERRAFORM: cdn("Terraform", "terraform"),
  AWS: local("Amazon Web Services", Aws),
  KUBERNETES: cdn("Kubernetes", "kubernetes"),
  ISTIO: cdn("Istio (Service Mesh)", "istio"),
  HELM: cdn("Helm", "helm"),
  DOCKER: cdn("Docker", "docker"),
  DIGITALOCEAN: cdn("DigitalOcean", "digitalocean"),
  CLOUDFLARE: cdn("Cloudflare", "cloudflare"),

  // CI/CD & Monitoring
  GITLAB: cdn("GitLab Pipelines", "gitlab"),
  JENKINS: cdn("Jenkins", "jenkins"),
  PROMETHEUS: cdn("Prometheus", "prometheus"),
  GRAFANA: cdn("Grafana", "grafana"),
  DATADOG: cdn("Datadog", "datadog"),
  SUMOLOGIC: cdn("Sumologic", "sumologic"),
  PAGERDUTY: cdn("PagerDuty", "pagerduty"),
  LOKI: cdn("Loki (Log Aggregation)", "grafana"),

  // Programming Languages
  PYTHON: cdn("Python", "python"),
  GO: cdn("Go", "go"),
  BASH: cdn("Bash - Zsh", "gnubash"),
  CPP: cdn("C++", "cplusplus"),

  // Communication & Collaboration
  SLACK: local("Slack Workflows", SlackIcon),

  // Soft Skills (local SVG components — no CDN equivalent)
  FLEXIBILITY: local("Flexibility and Adaptability", Flexibility),
  TEAMWORK: local("Teamwork", Team),
  INITIATIVE: local("Proactivity", Iniciative),
  CRITIC: local("Critical Thinking", Critic),
  PROBLEMRES: local("Problem Solving", ProblemResolution),
  LEARN: local("Always Learning", Learn),

  // Version Control
  GIT: cdn("Git", "git"),
  GITHUB: cdn("Github", "github"),

  // System Administration
  LINUX: cdn("Linux", "linux"),
};
