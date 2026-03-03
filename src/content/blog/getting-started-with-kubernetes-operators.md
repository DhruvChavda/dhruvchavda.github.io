---
title: "Getting Started with Kubernetes Operators"
description: "A practical guide to understanding and building Kubernetes Operators for automating complex application lifecycle management."
pubDate: 2026-03-03
category: "Kubernetes"
tags: ["kubernetes", "operators", "go", "automation"]
draft: false
---

## Introduction

Kubernetes Operators extend the Kubernetes API to create, configure, and manage complex applications. They encode operational knowledge into software, automating tasks that would otherwise require manual intervention.

## What is an Operator?

An Operator is a method of packaging, deploying, and managing a Kubernetes application. It uses Custom Resource Definitions (CRDs) to extend the Kubernetes API and a custom controller to watch for changes to those resources.

### Custom Resource Definitions

Here's an example of a CRD definition:

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: myapps.example.com
spec:
  group: example.com
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                replicas:
                  type: integer
                image:
                  type: string
  scope: Namespaced
  names:
    plural: myapps
    singular: myapp
    kind: MyApp
```

### The Reconciliation Loop

The heart of every operator is the **reconciliation loop**. This is a function that runs whenever the state of your custom resource changes:

```go
func (r *MyAppReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    // 1. Fetch the MyApp instance
    myapp := &examplev1.MyApp{}
    err := r.Get(ctx, req.NamespacedName, myapp)
    if err != nil {
        return ctrl.Result{}, client.IgnoreNotFound(err)
    }

    // 2. Define the desired Deployment
    deployment := &appsv1.Deployment{
        ObjectMeta: metav1.ObjectMeta{
            Name:      myapp.Name,
            Namespace: myapp.Namespace,
        },
        Spec: appsv1.DeploymentSpec{
            Replicas: &myapp.Spec.Replicas,
            // ... deployment spec
        },
    }

    // 3. Create or update the Deployment
    _, err = ctrl.CreateOrUpdate(ctx, r.Client, deployment, func() error {
        // Set MyApp as the owner
        return ctrl.SetControllerReference(myapp, deployment, r.Scheme)
    })

    return ctrl.Result{}, err
}
```

## Building Your First Operator

The easiest way to get started is with the **Operator SDK** or **Kubebuilder**:

```bash
# Install operator-sdk
brew install operator-sdk

# Create a new project
operator-sdk init --domain=example.com --repo=github.com/youruser/myapp-operator

# Create an API
operator-sdk create api --group=example --version=v1 --kind=MyApp --resource --controller
```

## Key Takeaways

1. **Operators automate Day 2 operations** — not just deployment, but scaling, upgrades, backups, and recovery
2. **Start simple** — begin with a basic reconciler and add complexity incrementally
3. **Use established frameworks** — Kubebuilder and Operator SDK handle boilerplate for you
4. **Test thoroughly** — use envtest for integration tests and controller-runtime's fake client for unit tests

## Next Steps

In the next post, we'll dive deeper into building a production-ready operator with proper RBAC, webhooks, and monitoring integration.
