---
title: "From Docker Compose to Kubernetes: A Practical Migration Guide"
description: "A step-by-step guide on migrating your Docker Compose applications to Kubernetes without losing your sanity."
pubDate: 2026-03-01
category: "Kubernetes"
tags: ["kubernetes", "docker", "containers", "migration"]
draft: false
---

## Why Migrate?

Docker Compose is fantastic for local development and small deployments. But once your application grows beyond a handful of services, you start hitting its limits. No built-in auto-scaling, no rolling deployments, limited health checking, and zero self-healing capabilities. Kubernetes solves all of these — but the migration can feel overwhelming if you don't have a clear plan.

This guide walks through a practical, incremental approach to moving your Docker Compose stack to Kubernetes.

## Step 1: Audit Your Compose File

Before touching Kubernetes, understand what you actually have. Pull up your `docker-compose.yml` and map out every service, volume, network, and environment variable.

```yaml
# Typical docker-compose.yml
services:
  api:
    build: ./api
    ports:
      - "8080:8080"
    environment:
      - DATABASE_URL=postgres://db:5432/app
    depends_on:
      - db
      - redis
  db:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=app
      - POSTGRES_PASSWORD=secret
  redis:
    image: redis:7-alpine
volumes:
  pgdata:
```

For each service, note down: the image (or build context), exposed ports, environment variables, persistent volumes, and inter-service dependencies. This becomes your migration checklist.

## Step 2: Containerize Properly

If you're using `build:` in Compose, make sure your Dockerfiles are production-ready. That means multi-stage builds, non-root users, and minimal base images.

```dockerfile
# Multi-stage build for a Go API
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o server .

FROM alpine:3.19
RUN adduser -D appuser
USER appuser
COPY --from=builder /app/server /server
EXPOSE 8080
CMD ["/server"]
```

Push your images to a container registry (Docker Hub, GitHub Container Registry, or ECR) before deploying to Kubernetes.

## Step 3: Translate to Kubernetes Resources

Here's the mapping between Compose concepts and Kubernetes resources:

| Docker Compose | Kubernetes |
|---|---|
| `services` | Deployment + Service |
| `ports` | Service (ClusterIP/NodePort/LoadBalancer) |
| `volumes` | PersistentVolumeClaim |
| `environment` | ConfigMap / Secret |
| `depends_on` | Init containers / readiness probes |

For the API service above, the Kubernetes equivalent would be:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: ghcr.io/youruser/api:latest
          ports:
            - containerPort: 8080
          envFrom:
            - configMapRef:
                name: api-config
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: api
spec:
  selector:
    app: api
  ports:
    - port: 8080
      targetPort: 8080
```

## Step 4: Handle Secrets and Config

Never hardcode passwords in manifests. Use Kubernetes Secrets for sensitive data and ConfigMaps for everything else. Better yet, integrate with an external secrets manager like AWS Secrets Manager or HashiCorp Vault using the External Secrets Operator.

```bash
kubectl create secret generic db-credentials \
  --from-literal=POSTGRES_PASSWORD=secret
```

## Step 5: Migrate Incrementally

Don't try to move everything at once. Start with your stateless services (APIs, workers, frontends) since they're the simplest to migrate. Leave stateful services like databases for last — or consider using managed services (RDS, Cloud SQL) instead of running them in Kubernetes.

A solid migration order:
1. Stateless APIs and web servers
2. Background workers and cron jobs
3. Cache layers (Redis, Memcached)
4. Databases (or switch to managed alternatives)

## What Comes Next

Once your services are running in Kubernetes, you unlock powerful capabilities: horizontal pod autoscaling, rolling deployments with zero downtime, built-in service discovery, and a rich ecosystem of tools for observability and security. The initial migration takes effort, but the operational benefits compound over time.

Start small, iterate, and don't be afraid to keep Docker Compose for local development — the two work great together.
