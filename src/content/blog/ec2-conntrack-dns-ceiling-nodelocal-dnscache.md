---
title: "The Invisible DNS Ceiling: How EC2 Connection Tracking Throttled Our EKS Cluster"
description: "EC2 connection tracking silently dropped our cluster's DNS packets and capped DNS for 42 hours. How we found it, and how NodeLocal DNSCache fixed it."
pubDate: 2026-10-19
category: ["AWS", "Kubernetes", "DevOps"]
tags: ["aws", "kubernetes", "eks", "dns", "coredns", "nodelocal-dnscache", "networking", "incident", "sre"]
draft: false
---

## TL;DR ⚡

- **Symptom:** "Grafana is down." It wasn't. Its DNS lookups were timing out, so log queries failed, logins bounced, and dashboards hung for 15–35 seconds before returning a 401.
- **Root cause:** every DNS lookup in the cluster crossed the network to the one or two nodes running CoreDNS. EC2 tracks every network flow on an instance, and every lookup is a new flow. The CoreDNS node's connection-tracking table filled up, and **AWS silently dropped packets below the operating system**. No kernel counter, CoreDNS metric or log line showed it.
- **Hidden cost:** it didn't just cause timeouts. It **capped the whole cluster's DNS at ~1,830 lookups/sec for 42 hours**. We only noticed once the cap was gone and the cluster resolved ~7,000/sec.
- **The check that found it:** `ethtool -S ens5` on the CoreDNS node → `conntrack_allowance_exceeded: 84,469,253`.
- **Fix:** NodeLocal DNSCache, a DNS cache on every node. Dropped packets went to **0**, 84% of lookups are now answered on the node, and CoreDNS load fell by ~85%.
- **Bonus lesson:** my first mitigation made things worse. An EKS add-on update quietly wiped a hand-patched setting, and cluster DNS ran on a single pod for five minutes.

---

## "Grafana Is Down" 🚨

It started the way these things usually do: a message saying Grafana on production was down.

It wasn't. The pod was running, `/api/health` answered in 90 ms, and the page loaded. But almost everything *behind* the page was broken:

| What people saw | What the logs said |
|---|---|
| Log panels failing after exactly 10 s | `dial tcp: lookup loki-gateway.loki.svc.cluster.local: i/o timeout` |
| Bounced back to the SSO login page | `Post "https://<sso-provider>/oauth2/v2.0/token": context deadline exceeded` |
| Dashboards "very slow", then logged out | `Failed to authenticate request … lookup <grafana-db>.rds.amazonaws.com on 172.20.0.10:53: read udp …: i/o timeout` followed by `status=401 time_ms=35034` |

That last one explains the whole user experience. **Grafana keeps its users and sessions in a database on RDS.** To check your session it needs a database connection. To open one it needs to resolve the RDS hostname. If that DNS lookup is lost, Grafana can't verify you, so a dropped DNS packet becomes a logout.

Two more things stood out:

- **The failures were bursty.** Nothing for minutes, then 15 errors in the same millisecond, all sharing **one UDP source port**. One lost packet failed every request waiting on that lookup.
- **They were chronic.** Grafana had been logging 1–3 of these an hour for days. They only became unbearable that morning.

## How DNS Works in an EKS Cluster 🧭

To see where this goes wrong, you need the path a DNS query takes.

Every pod's `/etc/resolv.conf` points at `172.20.0.10`, the `kube-dns` Service (the EKS default). That IP doesn't belong to any machine. kube-proxy on the pod's node rewrites (DNATs) each packet to the IP of one CoreDNS pod, and the packet then travels across the VPC to whichever node runs that pod.

![Before: every DNS lookup from every pod crosses the network to the node running CoreDNS, where the EC2 connection-tracking table is full](/pictures/blog/dns-conntrack-before.svg)

Two details make this fragile:

1. **Each lookup uses a fresh random source port.** To the network, every lookup is a brand-new flow: new 5-tuple (source IP, source port, destination IP, destination port, protocol).
2. **About 80% of our lookups were wasted.** Pods default to `ndots:5`, so a name like `api.example.com` is first tried as `api.example.com.<namespace>.svc.cluster.local`, then `api.example.com.svc.cluster.local`, and so on. Each attempt returns NXDOMAIN, and each is another flow.

Our CoreDNS replicas had also been pinned, months earlier and by hand, to a small node pool. At the moment that mattered, **all four replicas were on a single `.large` instance.**

## The Hidden Limit: EC2 Connection Tracking 🔒

Security groups are **stateful**. To let the reply to your request back in, AWS remembers each flow passing through an instance's network interface. This is **connection tracking**, and it happens in the Nitro hypervisor, not in your OS.

The table is finite and scales with instance size. AWS exposes it through the ENA driver:

```bash
$ ethtool -S ens5 | grep -E 'allowance_exceeded|allowance_available'
     bw_in_allowance_exceeded: 0
     bw_out_allowance_exceeded: 0
     pps_allowance_exceeded: 0
     conntrack_allowance_exceeded: 0        # packets DROPPED because the table was full
     linklocal_allowance_exceeded: 0
     conntrack_allowance_available: 151803  # how many more flows fit right now
```

A flow is untracked only if its security-group rules allow the traffic from `0.0.0.0/0` (or `::/0`) in **both** directions. Ours, like most EKS node security groups, reference other security groups, so **every DNS flow is tracked**.

When the table is full, new flows are dropped. You get no error, no RST and no log entry: the packet simply never arrives.

## The Investigation (a.k.a. Everything Looked Fine) 🔍

This is the part I want to be honest about, because every wrong turn looked convincing at the time.

| # | Hypothesis | Why it looked right | Why it was wrong |
|---|---|---|---|
| 1 | Grafana is down | That's what was reported | Healthy pod, 90 ms health check |
| 2 | The VPC resolver's 1,024 packets/sec per-ENI limit | CoreDNS logged `read udp …->10.0.0.2:53: i/o timeout` | Only ~15 queries/sec went upstream, and `linklocal_allowance_exceeded` was 0. Those errors were long-standing noise for dead external domains. |
| 3 | All CoreDNS replicas on one node | True, and it concentrated the load | Spreading them over two nodes **split** the problem. The second node started dropping packets too. |
| 4 | "Fixed" after spreading them out | A 30-lookup test passed | The failures were bursty, and Grafana logged more bursts minutes later |
| 5 | A kernel or CoreDNS problem | Something had to be dropping packets | Kernel conntrack drops 0, NIC drops 0, UDP buffer errors 0, CoreDNS p99 a flat 1.8 ms |
| 6 | "Traffic is normal: same as yesterday" | CoreDNS served the same ~1,830 queries/sec as the day before | It was the same **because it was capped** (more on this below) |

Hypothesis 5 is the interesting one. Every layer we normally look at said everything was fine:

![Four layers: application logs show rare errors, CoreDNS metrics look perfect, kernel counters are all zero, and only the EC2 hypervisor's connection-tracking counter shows 84 million dropped packets](/pictures/blog/dns-conntrack-signals.svg)

CoreDNS can't report a query it never received. The kernel can't count a packet the hypervisor dropped before delivering it. And the application only notices when an unlucky lookup times out.

## The Smoking Gun 🔫

When packets vanish and every metric is clean, look below the OS. A read-only check over SSM on the three nodes involved settled it:

```text
coredns-node-1 (c6g.large, all 4 CoreDNS pods)
     conntrack_allowance_exceeded: 84469253     conntrack_allowance_available: 6733
coredns-node-2 (m7g.large, CoreDNS moved here during mitigation)
     conntrack_allowance_exceeded: 121955       conntrack_allowance_available: 5325
grafana-node   (m6g.large)
     conntrack_allowance_exceeded: 0            conntrack_allowance_available: 151803
```

**84 million dropped packets** on the CoreDNS node over its 2.8-day life. The kernel's own connection table showed what was filling it:

```text
31050 udp dport=53   ← DNS, ~90% of every tracked flow on the node
 1044 tcp dport=443
  336 tcp dport=10254
  …
```

Here's one dashboard load, step by step:

1. You open a dashboard. Grafana needs to verify your session, so it needs the IP of its RDS database.
2. It sends a UDP query from `10.0.3.17:53781` to `172.20.0.10:53`. kube-proxy rewrites the destination to a CoreDNS pod on `coredns-node-2`.
3. The packet reaches that node's network card. AWS needs a tracking entry for this new flow, but the table is full of every other pod's recent lookups. **The packet is dropped.** Nothing logs it.
4. Grafana's resolver waits 5 s and retries, possibly into the same full table. After 15–35 s it gives up: no database, no session check, **401**.
5. Every other request waiting on that same lookup fails at the same instant. That's the burst.

## Making It Worse Before Making It Better 🤦

Before I found the real cause, I made a mitigation that caused its own outage. It's a trap worth knowing about.

CoreDNS on EKS is a **managed add-on**. Its placement had been hand-patched months earlier (`kubectl patch`, outside the add-on config): a `nodeSelector` for a specific node pool, a toleration for that pool's taint, and 4 replicas. To spread the replicas out, I pushed topology spread constraints through the add-on API with `--resolve-conflicts OVERWRITE`:

```text
                     hand-patched deployment         after update-addon OVERWRITE
                     ───────────────────────         ────────────────────────────
nodeSelector         nodepool=small-arm-pool   →     nodepool=small-arm-pool   (not managed: KEPT)
tolerations          [..., arm=true:NoExecute] →     [defaults only]           (managed: RESET)
replicas             4                         →     2                         (managed: RESET)
spread constraints   –                         →     added
```

The new pods were pinned by the surviving `nodeSelector` to nodes they could no longer tolerate, so they sat in `Pending`. Meanwhile the rolling update (`maxUnavailable: 1`) scaled the old ReplicaSet down. **For five minutes the whole cluster's DNS ran on one CoreDNS pod.** Restoring the toleration and replica count by hand brought it back.

The lesson isn't "don't use OVERWRITE". It's **"never hand-patch a managed add-on"**, and before any add-on update, diff the live deployment against the add-on's `configurationValues`. Anything that lives only in a hand-patch is one update away from disappearing.

## The Fix: NodeLocal DNSCache 🛠️

### Why CoreDNS's own cache doesn't help

CoreDNS already caches (`cache 30` is in the default Corefile). But that cache sits **on the far side of the network**. Every packet still has to reach the CoreDNS node, and that's exactly where the tracking entry is created. A cache at the destination can't stop the packet being sent.

### Options considered

| Option | What it does | Verdict |
|---|---|---|
| CoreDNS `autopath` | CoreDNS walks the search path itself: 1 round trip instead of 4–5 | Cuts flows 3–4×, but every lookup still crosses the network |
| More CoreDNS replicas on bigger nodes | Divides flows across more tables | Has to keep growing with traffic |
| `ndots: 2` on noisy workloads | Fewer wasted lookups | Worth doing, but per-workload, and doesn't remove the cause |
| Open the node SG to `0.0.0.0/0` both ways | Flows become untracked | Not a security trade-off I'd make |
| **NodeLocal DNSCache** | A cache on every node; most lookups never leave the node | **Chosen**: removes per-lookup network flows entirely |

### How it works

[NodeLocal DNSCache](https://kubernetes.io/docs/tasks/administer-cluster/nodelocaldns/) is an official Kubernetes add-on: CoreDNS packaged as a DaemonSet, one pod per node. EKS doesn't enable it by default.

![After: a node-local cache answers pods on the same node; cache misses for cluster names go to CoreDNS over a few long-lived TCP connections, and external names go straight to the VPC resolver](/pictures/blog/dns-conntrack-after.svg)

On each node it:

1. Creates a dummy interface holding `169.254.20.10` **and `172.20.0.10`**, the IP pods already use for DNS.
2. Adds iptables `NOTRACK` rules, so packets to `172.20.0.10:53` are delivered to the local cache instead of being DNAT'd to CoreDNS. **No pod, kubelet or `resolv.conf` change is needed.**
3. Answers from its cache when it can.
4. On a miss:
   - `*.cluster.local` names go to CoreDNS over **TCP**, reusing a few long-lived connections.
   - External names (databases, SSO, public domains) go straight from the node to the VPC resolver.

The key idea: **the number of flows CoreDNS sees now depends on the number of nodes, not the number of lookups.**

### Configuration

I used the [`deliveryhero/node-local-dns`](https://github.com/deliveryhero/helm-charts/tree/master/stable/node-local-dns) Helm chart:

```yaml
config:
  dnsDomain: "cluster.local"
  dnsServer: "172.20.0.10"     # your kube-dns ClusterIP: kubectl -n kube-system get svc kube-dns
  localDns: "169.254.20.10"
  # Bind ONLY these two IPs. The chart default (0.0.0.0) on hostNetwork also answers
  # on the node's VPC IP: an open resolver inside your VPC.
  bindIp: true
  # Reuse TCP connections to CoreDNS instead of new UDP flows. This is the core of the fix.
  commProtocol: "force_tcp"

resources:
  requests:
    cpu: 25m
    memory: 64Mi
  limits:
    memory: 192Mi   # headroom: an OOM-kill means DNS is down on that node until restart

serviceMonitor:
  enabled: true
  labels:
    release: kube-prometheus-stack
```

Pre-flight checks:
- **kube-proxy is in iptables mode** (`kubectl -n kube-system get cm kube-proxy-config -o yaml | grep mode`). IPVS mode needs a different setup: kubelet's `--cluster-dns` must point at `169.254.20.10`.
- **Nothing on the nodes listens on port 53.** On AL2023 the systemd-resolved stub is off by default. Bottlerocket needs checking.
- **The CoreDNS Corefile has no custom zones.** If it does, they must be added to the node cache too (see Guardrails).
- **The image is multi-arch** if you run Graviton nodes (it is).

### Rollout

```bash
# Staging first
helm upgrade --install node-local-dns ./node-local-dns -n kube-system \
  -f values-staging.yaml --kube-context staging
kubectl --context staging -n kube-system rollout status ds/node-local-dns

# Then production (~100 nodes): 106/106 Ready in 15 seconds
helm upgrade --install node-local-dns ./node-local-dns -n kube-system \
  -f values-prod.yaml --kube-context prod
```

One gotcha: on a **first** install a DaemonSet starts on every node at once. The `maxUnavailable: 10%` setting only applies to later upgrades. That's why staging first matters.

Rollback is one command, `helm uninstall node-local-dns -n kube-system`. Each pod removes its interface and iptables rules on graceful shutdown, and DNS falls back to kube-proxy → CoreDNS.

## Before and After 📊

### The CoreDNS nodes

| Metric | Before | After |
|---|---|---|
| Packets dropped by AWS | ~28–52 / sec | **0** (sustained for 48 min, and counting) |
| Free tracking capacity | **0** and **8** | ~150,000 each |
| Tracked UDP DNS flows per node | ~33,000 | **0** |
| TCP DNS connections (from node caches) | 0 | ~450 |

### Cluster-wide

| Metric | Before | After |
|---|---|---|
| DNS lookups answered | ~3,650/sec (capped) | **~7,000–7,400/sec** |
| Lookups answered on the node | 0% | **84%** |
| Queries reaching CoreDNS | all of them | ~530–790/sec (~10%) |
| SERVFAIL | n/a | 0 |
| Test lookups across every node type | intermittent failures | 390/390 OK |
| Cache pod footprint (busiest node) | n/a | 16.6 MiB memory, 51m CPU |

## The Plot Twist: A 42-Hour Throughput Ceiling 📉

That "~7,000 lookups/sec" didn't add up. During the incident, CoreDNS was serving ~1,830/sec, "the same as yesterday". So I pulled a week of CoreDNS request rates:

![Line chart of DNS queries answered per second: varying between 2,200 and 3,900 for five days, then dead flat at about 1,830 for 42 hours, flat at about 3,650 after spreading to two nodes, and above 7,000 after NodeLocal DNSCache](/pictures/blog/dns-conntrack-ceiling.svg)

- **For five days** the rate rose and fell with the time of day, like real traffic does.
- **Then it went dead flat at ~1,830/sec for 42 hours**, starting the minute the fourth CoreDNS replica was scheduled onto that one node.
- **When CoreDNS was spread over two nodes**, it jumped to ~3,650/sec and went flat again: two tables, twice the ceiling.
- **With NodeLocal DNSCache** the ceiling disappeared, and ~7,000+/sec turned out to be the real demand.

A full tracking table doesn't only drop packets. It **limits how fast new DNS flows can be admitted**: new ones get in only as old ones expire. Throughput tracked the number of CoreDNS *hosts*, not demand.

And here's why so few errors were logged: most clients wait for each lookup before sending the next. When lookups stall, they don't fail, they **slow down**. The cap showed up as slower work across the cluster (most of our DNS demand came from a pool of high-throughput worker nodes), and only the unlucky packets surfaced as `i/o timeout`. "Same as yesterday" was true, because yesterday was capped too.

## Trade-offs ⚖️

### Pros

- **Removes the root cause.** Per-lookup flows to CoreDNS nodes are gone, so the tracking limit no longer applies to DNS.
- **Removes the throughput ceiling.** DNS capacity scales with node count.
- **Faster.** Cache hits are answered in under 1 ms, with no network hop.
- **Much less CoreDNS load.** About 85% fewer queries reach it.
- **No more pod ↔ CoreDNS UDP loss**, including the well-known Linux conntrack race on parallel A/AAAA lookups that causes 5-second DNS stalls.
- **Transparent and reversible.** No app changes; rollback is one `helm uninstall`.
- **Per-node DNS metrics.** You can finally see *which* node has DNS trouble.

### Cons

- **A new critical component on every node.** If a node's cache breaks, *that node's* DNS breaks. The blast radius shrinks from "random pods cluster-wide" to "one node", but it's a new failure mode to monitor.
- **Privileged DaemonSet.** It runs on the host network with `NET_ADMIN` and edits iptables. If it's `SIGKILL`ed or OOM-killed, its rules can linger and DNS on that node fails until it restarts.
- **Two layers of cache.** A `cluster.local` record can be stale for up to ~60 s instead of ~30 s. That matters for headless Services whose pod IPs churn.
- **External names bypass CoreDNS.** Any CoreDNS rule for an external zone (forwarding `corp.internal` to a private DNS server, rewrites) is invisible to pods unless you add it to the node cache too.
- **Not an EKS managed add-on.** You own the chart and image upgrades.
- **Coupled to cluster settings.** Changing the kube-proxy mode or the kube-dns IP means reconfiguring it.
- **Your CoreDNS dashboards change meaning.** CoreDNS now sees only cache misses; total demand lives in the node-cache metrics.
- **Demand is unthrottled.** If workloads were secretly DNS-bound, they'll speed up and push more load downstream. Know that before the fix lands.

## Guardrails & Things to Watch 🚧

### Alerts worth adding

```text
# A node is missing its cache, so that node has broken DNS
kube_daemonset_status_number_unavailable{daemonset="node-local-dns"} > 0

# The cache can't reach CoreDNS: cluster-name lookups failing on that node
increase(coredns_forward_healthcheck_broken_total{job="node-local-dns"}[5m]) > 0

# SERVFAIL spike seen from a node
sum by (instance) (rate(coredns_dns_responses_total{job="node-local-dns", rcode="SERVFAIL"}[5m])) > 1

# EC2 allowance drops on ANY node (needs node-exporter --collector.ethtool)
rate(node_ethtool_conntrack_allowance_exceeded[5m]) > 0

# A DNS rate that barely moves for hours is a ceiling, not traffic. Tune the threshold.
stddev_over_time(sum(rate(coredns_dns_requests_total{job="node-local-dns"}[5m]))[6h:5m])
  / avg_over_time(sum(rate(coredns_dns_requests_total{job="node-local-dns"}[5m]))[6h:5m]) < 0.01
```

Also add a **client-side** DNS probe (for example blackbox exporter's `dns` module) from several nodes and AZs. Server-side metrics can't see the queries that never arrived. That was the whole problem.

### Rules I now follow

1. **Never hand-patch a managed add-on.** Put CoreDNS placement in the add-on's `configurationValues` (we keep it in Terraform), and diff the live spec before any update.
2. **Custom DNS zones go in both places**: the CoreDNS Corefile *and* the node cache config.
3. **Changing the kube-proxy mode or the kube-dns IP?** Reconfigure the node cache first.
4. **Upgrades go to staging first**, and you watch the DaemonSet alerts during the roll.
5. **Pods with `dnsPolicy: Default` or custom `dnsConfig.nameservers` bypass the cache.** That's intended, but they won't get the benefit.

## Lessons Learned 🎓

1. **When packets vanish and every metric is clean, look below the OS.** `ethtool -S` on the instances involved takes 10 seconds and would have saved hours. EC2 has per-instance limits (connection tracking, PPS, bandwidth, link-local) that drop packets silently.
2. **A flat line is a ceiling, not "normal".** A request rate with no daily variation is capacity talking, not demand. "Same as yesterday" might just mean "capped yesterday too".
3. **Spreading isn't scaling.** Moving CoreDNS from one node to two split the problem in half; it didn't remove it. Fix the per-request cost, not the number of places paying it.
4. **Don't declare victory on a bursty failure with a point test.** Thirty lookups that pass in a quiet gap prove nothing; watch the time series.
5. **Know your failure amplifiers.** A dropped DNS packet became a logout because session auth depended on resolving a database hostname. Find the paths in your stack where one small failure fans out.
6. **Managed doesn't mean "anything goes".** Managed add-ons own some fields and not others. A hand-patch is invisible configuration waiting to be half-reverted.
7. **Measure from the client side.** Servers only report the requests that reach them. This whole incident lived in the gap between the two.

## Try It Yourself 🧪

Check your own CoreDNS nodes. This is read-only and takes a minute:

```bash
# Which nodes run CoreDNS?
kubectl -n kube-system get pods -l k8s-app=kube-dns -o wide

# On each of those nodes (SSM, or: kubectl debug node/<node> -it --image=busybox -- chroot /host)
ethtool -S ens5 | grep -E 'allowance_exceeded|allowance_available'
```

If `conntrack_allowance_exceeded` is non-zero and climbing, or `conntrack_allowance_available` is near zero, you're dropping packets right now and nothing else will tell you.

Then look at a week of your DNS request rate:

```text
sum(rate(coredns_dns_requests_total[15m]))
```

If it looks like a ruler instead of a heartbeat, you've found your ceiling.

---

*This came out of a real production incident on an EKS cluster: one that looked like "Grafana is down" and turned out to be a silent ceiling under the whole cluster. Happy to talk EKS networking or DNS debugging on [LinkedIn](https://www.linkedin.com/in/dhruvchavda2712/).*
