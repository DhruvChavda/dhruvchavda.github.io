---
title: "Kubernetes Architecture: A Visual Deep Dive"
description: "A visual guide to understanding Kubernetes architecture, request flow, and networking with detailed diagrams."
pubDate: 2026-03-03
category: "Kubernetes"
tags: ["kubernetes", "architecture", "networking", "containers"]
heroImage: "/pictures/blog/k8s-architecture.svg"
heroImageAlt: "Kubernetes Cluster Architecture diagram showing control plane and worker nodes"
draft: false
---

## Overview

Kubernetes is a complex system, but at its core it follows a simple pattern: you declare the desired state, and Kubernetes works to make it reality. Understanding the architecture helps you debug issues faster, design better deployments, and make informed decisions about your infrastructure.

In this post, we'll walk through the key components with visual diagrams to make the concepts stick.

## Cluster Architecture

Every Kubernetes cluster has two main parts: the **Control Plane** and the **Worker Nodes**.

![Kubernetes Cluster Architecture](/pictures/blog/k8s-architecture.svg)

### The Control Plane

The control plane is the brain of the cluster. It makes global decisions about scheduling, detects and responds to cluster events, and manages the desired state of all resources.

**API Server** — The front door to your cluster. Every interaction (from `kubectl`, the dashboard, or internal components) goes through the API server. It handles authentication, authorization, admission control, and serves the REST API.

**etcd** — The cluster's source of truth. It's a distributed key-value store that holds the entire state of your cluster: deployments, services, secrets, config maps — everything. If etcd goes down, your cluster is blind.

**Scheduler** — Watches for newly created pods that have no node assigned and selects the best node to run them on. It considers factors like resource requirements, affinity rules, taints, tolerations, and data locality.

**Controller Manager** — Runs a set of controllers that watch the cluster state and make changes to move the current state towards the desired state. Some key controllers include:

- **ReplicaSet Controller** — Ensures the right number of pod replicas are running
- **Deployment Controller** — Manages rolling updates and rollbacks
- **Node Controller** — Monitors node health and responds to failures
- **Job Controller** — Manages batch workloads

### Worker Nodes

Worker nodes are where your actual application workloads run. Each node runs three critical components:

**Kubelet** — The agent that runs on every node. It takes instructions from the API server (pod specs) and ensures the containers described in those specs are running and healthy.

**Kube-proxy** — Handles network routing for services. It maintains network rules on nodes that allow communication to your pods from inside or outside the cluster.

**Container Runtime** — The software that actually runs containers. Kubernetes supports any CRI-compatible runtime: containerd, CRI-O, or others.

## Request Flow

When you run `kubectl apply -f pod.yaml`, here's exactly what happens:

![Kubernetes Request Flow](/pictures/blog/k8s-request-flow.svg)

1. **kubectl** sends the pod spec to the API server over HTTPS
2. **API Server** authenticates the request, validates the spec, and runs admission webhooks
3. **etcd** stores the pod spec as the desired state
4. **Scheduler** detects the unassigned pod and evaluates which node is the best fit based on resources, affinity, and constraints
5. **Kubelet** on the chosen node picks up the assignment and instructs the container runtime to pull the image and start the container
6. **Pod Running** — The container starts, health checks pass, and the pod is marked as Ready

This entire flow typically takes just a few seconds for a standard deployment.

## Networking Model

Kubernetes networking is often the most confusing part for newcomers. There are three service types that control how your pods are exposed:

![Kubernetes Networking Service Types](/pictures/blog/k8s-networking.svg)

### ClusterIP (Default)

The default service type. It assigns an internal IP that's only reachable from within the cluster. This is what you use for internal service-to-service communication.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend-api
spec:
  type: ClusterIP
  selector:
    app: backend
  ports:
    - port: 80
      targetPort: 8080
```

Other pods in the cluster can reach this service at `backend-api.default.svc.cluster.local:80`.

### NodePort

Extends ClusterIP by exposing the service on a static port (30000-32767) on every node's IP. Traffic to any node on that port gets routed to the service.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: frontend
spec:
  type: NodePort
  selector:
    app: frontend
  ports:
    - port: 80
      targetPort: 3000
      nodePort: 30080
```

You can now access the service at `<any-node-ip>:30080`. Useful for development or when you have your own load balancer sitting in front.

### LoadBalancer

The go-to choice for production workloads on cloud providers. It provisions an external load balancer (AWS ELB, GCP LB, Azure LB) that routes internet traffic to your service.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: public-api
spec:
  type: LoadBalancer
  selector:
    app: api
  ports:
    - port: 80
      targetPort: 8080
```

The cloud provider assigns a public IP, and traffic flows: Internet → Load Balancer → NodePort → ClusterIP → Pod.

## Key Takeaways

1. **The control plane manages state, worker nodes run workloads** — keep them separate in production
2. **etcd is critical** — always run it with proper backups and high availability (3 or 5 nodes)
3. **The API server is the single entry point** — every component communicates through it
4. **Service types build on each other** — LoadBalancer wraps NodePort, which wraps ClusterIP
5. **Understanding the request flow helps debugging** — if a pod isn't running, trace the flow to find where it's stuck

In the next post, we'll cover Kubernetes storage architecture and how PersistentVolumes, PersistentVolumeClaims, and StorageClasses work together.
