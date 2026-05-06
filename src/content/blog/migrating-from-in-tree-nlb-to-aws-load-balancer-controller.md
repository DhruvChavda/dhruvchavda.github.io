---
title: "Zero-Downtime Migration from In-Tree NLB to AWS Load Balancer Controller"
description: "A zero-downtime migration from the legacy in-tree Kubernetes cloud provider to the AWS Load Balancer Controller — annotation-only, no app changes."
pubDate: 2026-05-07
category: ["AWS", "Kubernetes", "DevOps"]
tags: ["aws", "kubernetes", "eks", "load-balancer", "ingress-nginx", "devops"]
draft: false
---

## The Setup 🛠️

If you've been running EKS for a while, you've probably noticed something quietly aging in the corner: the **in-tree AWS cloud provider**. You know, the thing that magically provisions an NLB whenever you slap `service.beta.kubernetes.io/aws-load-balancer-type: "nlb"` on a Service. It still works. It's been working for years. But it's been deprecated for almost as long, and every Kubernetes release prunes a little more from `kube-controller-manager`'s cloud paths.

The supported replacement is the **AWS Load Balancer Controller (LBC)** — a dedicated controller that runs inside your cluster, watches Services and Ingresses, and provisions NLBs and ALBs through modern AWS APIs.

I recently migrated four production NLBs (public + internal across staging and prod) from the in-tree provider to LBC. **Zero downtime. Zero dropped connections. No application changes. About ten minutes per cluster.** This post is the story of how, why, and the gotchas I hit along the way — with the zero-downtime trick spelled out so you can repeat it.

## Why Bother? 🤔

Honest answer: the existing NLBs work fine. Apps are happy. Why touch it?

A few reasons that made it worth the afternoon:

- **Pod-direct routing.** With `nlb-target-type: ip`, the NLB sends traffic straight to pod IPs — no NodePort hop, no kube-proxy on every request. Lower latency, real client IPs preserved natively, no `externalTrafficPolicy: Local` workarounds needed.
- **Pod-level health checks.** Real HTTP `/healthz` checks against the actual pod, instead of a TCP probe to a NodePort that happens to be listening.
- **NLBv2** instead of the older NLBv1 the in-tree provider creates. Faster failover, managed security groups, modern API.
- **The in-tree provider is deprecated.** This is going to bite eventually. Better to migrate on a calm Tuesday than during an incident.
- **Future-readiness.** If you ever want ALB ingress, WAF, Shield, Cognito, or auto-binding ACM certificates — that's all LBC.

## The Decision: NLB or ALB? 🎯

When you start reading about LBC, you immediately face a fork in the road: keep nginx-ingress with a modernized NLB, or rip nginx out and let ALB do Layer-7 routing natively?

I went with **NLB-only, nginx-ingress stays**. Here's why:

| | **ALB (replace nginx)** | **LBC NLB (keep nginx)** ✅ |
|---|---|---|
| Risk to apps using nginx-only features | High — `server-snippet`, regex `rewrite-target`, basic-auth, complex CORS, etc. all break | Zero — no Ingress changes |
| Time to deliver | Weeks of per-app remediation | Hours |
| Needs ACM certificates | Yes | No |
| AWS rule limits | 100 rules per ALB by default | None |
| Pod-direct routing | Yes | Yes |

When I audited my Ingress resources, around 10–15 of them used nginx-only features that ALB simply can't reproduce without rewriting the apps. That ruled out ALB for now. But the bigger insight: **the migration to LBC-managed NLBs is a pure annotation change**. You get most of the operational wins immediately, and ALB adoption can come later for greenfield ingresses.

## Architecture: Before and After 🏗️

### Before — in-tree NLB

```
   Cloudflare (proxied)
          │
          ▼
   In-tree NLB (NLBv1)
          │
          ▼  NodePort
   kube-proxy (iptables)
          │
          ▼
   nginx-ingress pod
          │
          ▼
   application pod
```

### After — LBC-managed NLBv2

```
   Cloudflare (proxied)
          │
          ▼
   LBC-managed NLBv2
          │
          ▼  direct to pod IP
   nginx-ingress pod
          │
          ▼
   application pod
```

Notice what's gone in the new diagram: the kube-proxy hop. The NLB now talks directly to nginx pods. Cleaner, faster, easier to debug.

What stayed exactly the same: every Ingress resource, the nginx chart version, replica counts, ConfigMaps, application pods, and the CDN configuration in front. **The only thing that changed was a handful of annotations on one Service.**

## Pre-Flight Checklist ✈️

Before touching anything in production, you need a few things in place.

### 1. IAM (IRSA) for the controller

LBC needs an IAM role trusted by your cluster's OIDC provider, attached to its ServiceAccount. The policy is the standard `AWSLoadBalancerControllerIAMPolicy` published by AWS. Wire it up via:

```yaml
serviceAccount:
  create: true
  name: aws-load-balancer-controller
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::<ACCOUNT_ID>:role/<CLUSTER>-aws-lbc-role
```

### 2. VPC subnet tags

LBC discovers where to provision LBs from subnet tags:

| Tag | Public subnets | Private subnets |
|---|---|---|
| `kubernetes.io/role/elb` | `1` | — |
| `kubernetes.io/role/internal-elb` | — | `1` |
| `kubernetes.io/cluster/<cluster-name>` | `shared` or `owned` | `shared` or `owned` |

If you've been running EKS for a while these are likely already in place — the in-tree provider uses them too.

### 3. Verify nginx exposes /healthz on its expected port

The new NLB will health-check pods directly on `HTTP /healthz` at port `10254`. Verify this works *before* you change anything:

```bash
POD=$(kubectl -n ingress-nginx get pods -l app.kubernetes.io/instance=ingress-nginx \
        -o jsonpath='{.items[0].metadata.name}')
kubectl -n ingress-nginx exec $POD -- wget -qO- http://127.0.0.1:10254/healthz
# Expect: ok
```

If this returns `ok`, you're good. If it doesn't — stop. Fix that first.

## Installing the Controller 📦

Standard Helm install with one important caveat. If you're running `replicaCount: 2` *and* the chart's default `configureDefaultAffinity: true` (which adds anti-affinity), the node pool you target **must have at least 2 nodes** — otherwise one replica stays `Pending` forever. Ask me how I know. 😅

```bash
helm upgrade --install aws-load-balancer-controller \
    eks/aws-load-balancer-controller \
    -n kube-system \
    -f values.yaml
```

Verify it's healthy:

```bash
kubectl -n kube-system get pods -l app.kubernetes.io/name=aws-load-balancer-controller
# Expect: 2/2 Running

kubectl get ingressclass
# Expect: alb (controller: ingress.k8s.aws/alb)
```

## The Annotation Swap ✨

Here's the entire migration, in two places.

### Public NLB

**Before:**

```yaml
service.beta.kubernetes.io/aws-load-balancer-type: "nlb"
service.beta.kubernetes.io/aws-load-balancer-cross-zone-load-balancing-enabled: "true"
service.beta.kubernetes.io/aws-load-balancer-backend-protocol: "tcp"
```

**After:**

```yaml
service.beta.kubernetes.io/aws-load-balancer-type: "external"
service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: "ip"
service.beta.kubernetes.io/aws-load-balancer-scheme: "internet-facing"
service.beta.kubernetes.io/aws-load-balancer-cross-zone-load-balancing-enabled: "true"
service.beta.kubernetes.io/aws-load-balancer-backend-protocol: "tcp"
service.beta.kubernetes.io/aws-load-balancer-healthcheck-protocol: "HTTP"
service.beta.kubernetes.io/aws-load-balancer-healthcheck-path: "/healthz"
service.beta.kubernetes.io/aws-load-balancer-healthcheck-port: "10254"
```

For the internal NLB, swap `internet-facing` for `internal` (and remove the legacy `aws-load-balancer-internal: "true"` if you have it — that flag is the old way to do this).

### What each annotation actually does

| Annotation | Purpose |
|---|---|
| `aws-load-balancer-type: external` | The magic word. Tells the in-tree provider "not yours, walk away" while LBC's webhook recognises it as its trigger. |
| `nlb-target-type: ip` | Pod-direct routing. Skips NodePort and kube-proxy entirely. Real client IP preserved automatically. |
| `scheme: internet-facing` / `internal` | Explicit scheme. Replaces the old `aws-load-balancer-internal` flag. |
| `cross-zone-load-balancing-enabled: true` | Even traffic distribution across AZs even with imbalanced pod placement. |
| `backend-protocol: tcp` | NLB forwards raw TCP; nginx still terminates TLS at the origin. |
| `healthcheck-protocol: HTTP` + `path: /healthz` + `port: 10254` | Real HTTP health checks against the pod's healthz endpoint. |

### ⚠️ The trap I fell into

My first attempt also added `spec.loadBalancerClass: "service.k8s.aws/nlb"` for "explicitness". The Helm upgrade got rejected by the API server with a not-very-helpful error. Turns out **`spec.loadBalancerClass` is immutable** in Kubernetes 1.24+. Once a Service has it set (even to `""`), you can't change it without deleting and recreating the Service — which means downtime.

The lesson: for an in-tree-to-LBC migration, leave `loadBalancerClass` alone. The annotation `aws-load-balancer-type: external` alone is enough. `loadBalancerClass` is for *new* Services, not migrations.

## How This Stays Zero-Downtime 🪄

This is the part that made me trust the migration enough to run it in production. The zero-downtime guarantee isn't hand-waving — it's a direct consequence of how the two controllers behave.

When you change the annotation from `nlb` to `external`, **two controllers see the change**:

1. **In-tree CCM:** "value changed to `external`, not mine anymore" → stops managing the Service. **It does NOT delete the existing NLB** (it only deletes when the Service itself is deleted). The old NLB is now orphaned in AWS but still alive, still healthy, still routing to nginx via NodePort.
2. **LBC:** "value is `external`, that's mine" → provisions a *brand new* NLBv2, registers nginx pod IPs, attaches health checks.

For a glorious minute or two, **both NLBs are live**, both routing to the same nginx fleet — one via NodePort, the other via pod IPs. Then you update DNS at the CDN to point at the new NLB, and traffic gradually flows over as DNS caches refresh. Anyone still resolving the old hostname keeps getting served correctly because the old NLB hasn't gone anywhere.

Timeline:

| Step | Duration | Traffic state |
|---|---|---|
| Helm upgrade applies | < 5s | Old NLB serving 100% |
| LBC provisions new NLBv2 | 60–90s | Old NLB still serving 100% |
| New target group goes healthy | 30–60s | Old NLB still serving 100% |
| **DNS swap at CDN** | seconds | Both NLBs healthy; traffic split by DNS cache |
| CDN edges pick up new origin | 30–60s | Some clients on old (works), some on new (works) |
| Manual delete of old NLB (later) | minutes-to-hours later | New NLB serving 100% |

**Nothing is forced offline until you explicitly delete the old NLB after verifying.** That's why this is genuinely zero-downtime — not "low downtime" or "brief downtime", but actually zero. No request fails because both paths are functional throughout the cutover.

## The Cutover Procedure 🚀

For each cluster, run **internal first, then external** — internal has way smaller blast radius if something goes sideways.

```bash
# 1. Capture old NLB hostname (you'll need this for the DNS swap)
kubectl -n ingress-nginx get svc -o custom-columns='NAME:.metadata.name,HOSTNAME:.status.loadBalancer.ingress[0].hostname'

# 2. Helm upgrade with the new annotations
helm upgrade ingress-nginx ./ingress-nginx -f values.yaml -n ingress-nginx

# 3. Wait for the new NLB hostname to appear in Service status
OLD=<old hostname>
for i in $(seq 1 30); do
  HN=$(kubectl -n ingress-nginx get svc <name> \
       -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
  [[ "$HN" != "$OLD" && -n "$HN" ]] && { echo "NEW NLB: $HN"; break; }
  sleep 10
done
NEW=$HN

# 4. CRITICAL: wait for target group health BEFORE flipping DNS
NEW_ARN=$(aws elbv2 describe-load-balancers --region <region> \
    --query "LoadBalancers[?DNSName=='$NEW'].LoadBalancerArn" --output text)

aws elbv2 describe-target-groups --region <region> \
    --load-balancer-arn "$NEW_ARN" \
    --query 'TargetGroups[].TargetGroupArn' --output text \
    | tr '\t' '\n' > /tmp/tgs.txt

# Poll until every target is healthy
for i in $(seq 1 24); do
  U=0; T=0
  while read -r tg; do
    for state in $(aws elbv2 describe-target-health --target-group-arn "$tg" \
                   --region <region> \
                   --query 'TargetHealthDescriptions[].TargetHealth.State' --output text); do
      T=$((T+1)); [[ "$state" != "healthy" ]] && U=$((U+1))
    done
  done < /tmp/tgs.txt
  echo "[$i] healthy: $((T-U))/$T"
  [ "$U" -eq 0 ] && [ "$T" -gt 0 ] && { echo "ALL HEALTHY"; break; }
  sleep 10
done

# 5. Now you can safely flip DNS at the CDN
```

The polling loop is non-negotiable. **Never flip DNS until every target is `healthy`.** I cannot stress this enough.

## A Quick Note on the DNS Swap 🌐

I expected to update ~140 DNS records (one per ingress hostname). Reality: I had wildcard CNAMEs covering most of them, so it was more like **2 records for internal and 8–11 for external** per cluster. Much less work than feared.

If you're using a CDN with an API (Cloudflare, Route 53, etc.), wrap the swap in a small script that:

1. Lists all CNAMEs whose content equals the old NLB hostname
2. Updates each to point at the new NLB hostname
3. Preserves any per-record settings (proxied flag, TTL, etc.)
4. Defaults to a dry-run mode so you can preview before applying

Few minutes of scripting, much less stress on the day.

## Smoke Tests 🔍

After each leg, verify three things:

```bash
# 1. Targets are healthy
aws elbv2 describe-target-health --target-group-arn <arn> --region <region>

# 2. DNS resolves to the new NLB
dig +short CNAME some-host.example.com
# Expect: k8s-ingressn-...elb.<region>.amazonaws.com.

# 3. End-to-end HTTPS works
curl -sI --max-time 10 https://some-host.example.com/ \
    -o /dev/null -w 'HTTP=%{http_code} time=%{time_total}s\n'
# Expect: HTTP=200
```

### The "is the migration broken or is the app already broken?" trick

One of my smoke tests came back as `503`. My heart sank for a few seconds. Then I remembered — bypass the CDN, hit the new NLB directly, and see if it returns the same code:

```bash
NEW_IP=$(dig +short k8s-ingressn-...elb.<region>.amazonaws.com | head -1)
curl -sk --resolve example.com:443:$NEW_IP https://example.com/ \
    -o /dev/null -w 'HTTP=%{http_code}\n'
```

Same `503`. The app was already broken before the migration. **Always have a direct-to-LB curl recipe ready** to disambiguate "did the migration break this" from "is this already broken".

## Cleanup 🧹

The old NLB doesn't auto-delete on annotation change. It just sits there, idle, accruing about $16/month each. After a few minutes of stable smoke tests, delete it:

```bash
aws elbv2 delete-load-balancer --region <region> \
    --load-balancer-arn <old-arn>
```

This is irreversible, so wait until you're confident the new NLB is stable. I deleted within 5–10 minutes of cutover with zero issues — but that was after solid green smoke tests on every important hostname.

## Pitfalls I Hit (So You Don't Have To) 🪤

A consolidated list of every gotcha:

1. **`spec.loadBalancerClass` is immutable.** Don't touch it on a migration. Annotation-only.
2. **Internal NLB DNS doesn't resolve outside the VPC.** Don't gate your polling on external DNS resolution for an internal LB — use `aws elbv2 describe-load-balancers ... State.Code == active` instead.
3. **The old NLB doesn't auto-delete.** Plan for a manual cleanup step.
4. **Target health takes 60–120s to go green.** Don't panic, but also don't flip DNS early.
5. **zsh doesn't word-split unquoted variables by default** (bash does). If you write polling scripts, use `while read -r tg; do ... done < tgs.txt` instead of `for tg in $tgs`. Trust me.
6. **Pre-existing app errors look like regressions.** Have a direct-to-LB curl ready.
7. **ARM/multi-arch nodes:** if the controller image is multi-arch and you're scheduling on ARM, you're fine. Just make sure the node pool has enough capacity for `replicaCount` with anti-affinity.

## Rollback Plan 🔙

Within the same session, before deleting the old NLB, rollback is trivial:

1. **Reverse the DNS swap** (point CNAMEs back at the old NLB hostname). Old NLB is still alive and registered to nginx pods.
2. **Helm rollback** the ingress-nginx release. The legacy annotations come back; the in-tree CCM re-claims ownership of the existing old NLB.
3. **Delete the new (now orphaned) NLB.**

If you've already deleted the old NLB, recovery means re-running the Helm upgrade with the old annotations and letting the in-tree CCM provision a fresh NLB — same downtime profile as the original migration.

## Final State 🎉

After both clusters were migrated:

```
$ aws elbv2 describe-load-balancers --region <region> \
    --query 'LoadBalancers[?starts_with(LoadBalancerName, `k8s-ingressn`)].[LoadBalancerName,Scheme,State.Code]' \
    --output text

k8s-ingressn-ingressn-xxxxxxxxx   internet-facing   active
k8s-ingressn-ingressn-yyyyyyyyy   internal          active
k8s-ingressn-ingressn-zzzzzzzzz   internet-facing   active
k8s-ingressn-ingressn-wwwwwwwww   internal          active
```

Four NLBs. No orphans. All LBC-managed. All HTTP smoke tests green.

## Takeaways 💡

If you only remember three things from this post:

1. **An annotation-only migration is genuinely zero-downtime — not "low downtime", actually zero.** Both old and new NLBs coexist while DNS propagates. Nothing is forced offline. Every in-flight request completes on whichever path it landed on.
2. **Verify target health before flipping DNS.** Every. Single. Time. Don't trust "the LB exists in AWS" — trust "every target is `healthy`".
3. **Keep the old NLB around for a few minutes after cutover.** It's your free, instant rollback. Delete only after smoke tests pass.

The bigger picture: **the in-tree AWS cloud provider is on borrowed time**. If you're still on it, the migration is honestly easier than the procrastination. A calm afternoon, a checklist, and a couple of helm upgrades. That's it.

Happy migrating. 🚢

---

**Total cutover time per cluster:** ~10 minutes
**User-visible downtime:** Zero
**Wins:** Pod-direct routing, real HTTP health checks, modern API, future-ready for ALB/WAF/Shield
