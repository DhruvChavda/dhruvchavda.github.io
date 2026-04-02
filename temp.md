\resumeSection{Summary}
\textbf{CKA- and ICA-certified} DevOps/SRE Engineer with \textbf{4+ years} of experience building secure, automated, and observable Kubernetes platforms across cloud environments. Specialized in scaling infrastructure from \textbf{0 to 1} and hardening it for growth, with deep expertise in Platform Security, CI/CD automation, Istio, Kubernetes Operators, Observability, Production Incident handling, and Cost Optimization to improve reliability, developer productivity, and infrastructure efficiency.

\resumeSection{Technical Skills}
\textbf{Cloud \& Platforms:} AWS, DigitalOcean, Cloudflare \\[0.08em]
\textbf{Containers \& Orchestration:} Kubernetes, Docker, Istio (service mesh) \\[0.08em]
\textbf{Programming:} Python, Bash \\[0.08em]
\textbf{Infrastructure as Code:} AWS CloudFormation, Helm, Terraform* \\[0.08em]
\textbf{CI/CD:} GitLab Pipelines, Jenkins*, GitLeaks \\[0.08em]
\textbf{Monitoring \& Logging:} Prometheus, Grafana, Loki, Alertmanager, Datadog*, Sumo Logic \\[0.08em]
\textbf{Security \& Networking:} Cloudflare ZTNA \& Warp, Infisical (secret management), DNS, OAuth, RBAC \\[0.08em]
\textbf{Tooling:} Git, WordPress, Jira, Slack Workflows, Airflow, JSM, Microsoft Entra ID* \\[0.08em]
{\small\textit{* Elementary proficiency}}

\resumeSection{Experience}

\resumeRole{DevOps Engineer}{ZZAZZ AI}{Feb 2025 - Present}{Bangalore, India}
\resumeBlock{Kubernetes Architecture \& Observability}
\begin{itemize}
\item Owned and architected \textbf{secure Kubernetes platform architecture from scratch} across \textbf{multiple clusters}, supporting \textbf{\textasciitilde150 microservices per cluster}; introduced RBAC and network policies to improve isolation, security, and platform readiness.
\item Drove adoption of \textbf{open-source observability tooling} and built the platform-wide stack from scratch using \textbf{Prometheus, Grafana, Alertmanager}, and \textbf{Loki}; delivered \textbf{10+ Kubernetes dashboards} and team-specific alerting to improve troubleshooting and operational visibility across nodes, pods, workloads, compute, and networking.
\item Standardized deployment patterns for \textbf{150+ services/workloads} with reusable Helm templates, reducing per-service setup overhead and enabling more consistent, scalable self-service delivery across teams.
\end{itemize}

\resumeBlock{Staging Environment}
\begin{itemize}
\item Architected and delivered an \textbf{end-to-end staging environment} on a \textbf{separate VPC}, including Kubernetes, infrastructure, monitoring, security controls, and access guardrails to strengthen release safety and production readiness.
\end{itemize}

\resumeBlock{Self-Hosted GitLab \& CI/CD at Scale}
\begin{itemize}
\item Established and operationalized \textbf{self-hosted GitLab} for \textbf{55 users}, \textbf{264 projects}, and \textbf{20k+ pipelines}; transferred \textbf{250+ repositories} from Bitbucket with zero data loss and added DR automation with \textbf{RPO \textasciitilde24h, RTO \textasciitilde1h}.
\item Standardized CI/CD on Kubernetes-based runners, cutting container image build times by \textbf{60--70\%}, adding \textbf{GitLeaks} security scans, and introducing deployment guardrails such as central kill switches for safer releases.
\end{itemize}

\resumeBlock{Argus: AI Ops Chatbot}
\begin{itemize}
\item Developed \textbf{Argus}, an internal AI Ops chatbot on \textbf{Kubernetes, Prometheus, and Grafana MCP servers}, shortening developer cluster troubleshooting by \textbf{85\%+} and enabling self-serve debugging.
\item Launched an admin dashboard for chatbot monitoring, token cost analytics, and usage insights to increase operational visibility into internal AI tooling.
\end{itemize}

\resumeBlock{Cloudflare DNS \& Workers}
\begin{itemize}
\item Simplified ingress and edge routing with dynamic DNS allocation and a \textbf{single shared load balancer}, eliminating \textbf{60+ load balancers} and enabling faster, standardized ingress creation.
\item Transitioned \textbf{15+ frontend services} to \textbf{Cloudflare Workers and Pages}, strengthening edge delivery and standardizing end-to-end CI/CD automation for frontend releases.
\end{itemize}

\resumeBlock{ZTNA \& Infrastructure Security}
\begin{itemize}
\item Strengthened platform access controls by rolling out \textbf{Cloudflare ZTNA across 500+ droplets}, onboarding staging and production services behind private-network access patterns.
\item Enabled safer developer access by adding \textbf{Cloudflared + ZTNA} authenticated test endpoints for Kubernetes services and rolling out \textbf{Cloudflare Warp} for \textbf{35+ developers and contractors}.
\item Standardized multi-cloud operations across \textbf{DigitalOcean, AWS, and Cloudflare}, OAuth-enabled tooling, and resource tagging for better governance and cost accountability.
\end{itemize}

{\small\itshape Also served as a \textbf{24x7 on-call engineer} across cloud, platform, and infrastructure, supporting developer enablement, production incident response, and end-to-end platform ownership.\par}