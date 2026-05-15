---
title: "Your EFS-Backed PVC's storage Field Is a Lie"
description: "Why kubectl shows 3Gi on an EFS-backed PVC but the pod can write hundreds of GiB to it anyway — and what's actually happening underneath the hood."
pubDate: 2026-05-16
category: ["AWS", "Kubernetes", "DevOps"]
tags: ["aws", "kubernetes", "eks", "efs", "pvc", "storage", "csi"]
draft: false
---

## The Moment of Confusion 🤔

I was in the middle of migrating 300+ WordPress sites onto an EKS cluster — each site getting its own namespace, its own Helm release, its own PVC backed by EFS. The chart's defaults requested `3Gi` per PVC. I didn't think twice about it; the wp-content tarballs I was importing averaged ~500 MB, so 3 GiB looked generous.

Then I tarballed one site I'd forgotten about: 1.4 GB. Restored it. Worked fine. Restored another: 5.8 GB. Also fine. I ran `du -sh /bitnami/wordpress` inside the pod expecting to see "out of space" errors waiting for me, and instead saw this:

```
1.8G    /bitnami/wordpress
```

The PVC still said `3Gi` capacity. The pod had used almost *double* the supposed limit and was happily writing more. Either I was about to hit a wall, or — and this is what turned out to be the case — **the 3Gi number was never enforcing anything**.

Here's why.

## The Mental Model That's Wrong 🧠

Most of us learn PVCs through EBS first. The flow is intuitive:

```
PVC requests 3Gi  →  AWS creates a 3 GiB EBS volume  →
Block device mounted as /dev/xvdf  →  ext4 formatted on it  →
Pod writes until 3 GiB consumed  →  ENOSPC, writes fail
```

The `3Gi` is a **real physical limit**. The disk is 3 GiB. There is no 3.000001 GiB. The kernel will return `No space left on device` and your app's `write()` call will fail. This is what we expect from "storage capacity."

So when you switch to EFS and see the same `storage: 3Gi` field, the natural assumption is: *same thing, just over NFS instead of a block device*. Right?

Not right.

## The EFS Reality 🌊

EFS isn't a block device. It's a fully-managed NFS filesystem that **already exists** at petabyte scale. The AWS EFS CSI driver doesn't create a filesystem when you provision a PVC — it just creates an **Access Point**: a POSIX directory permission scoped to a subpath of the existing filesystem, with a default uid/gid and root directory.

Compare what the CSI drivers actually do:

```
                  PVC requests "3Gi"
                          │
                          ▼
              CSI driver translates the request
                          │
        ┌─────────────────┴──────────────────┐
        │                                    │
   EBS CSI driver                       EFS CSI driver
   (ebs.csi.aws.com)                    (efs.csi.aws.com, mode=efs-ap)
        │                                    │
        ▼                                    ▼
   Calls CreateVolume API:              Calls CreateAccessPoint API:
   "make me a 3 GiB                     "make me a directory under
    EBS volume"                          /dynamic/<ns>/<pvc-name>
        │                                with uid 1001 and these perms"
        ▼                                NO SIZE PARAMETER EXISTS
   Physical 3 GiB block                       │
   shows up in your account.                  ▼
        │                              You get a directory on the
        ▼                              shared EFS filesystem
   ext4 on top, mounted in pod.        (which is petabyte-scale).
   Hard ENOSPC at 3 GiB.                      │
                                              ▼
                                       Mounted in pod via NFS.
                                       No quota enforcement
                                       anywhere in the stack.
```

The EFS Access Point API genuinely has no `size` field. You can `aws efs create-access-point` all day long — there's nowhere to specify "this AP is limited to 3 GiB." It doesn't exist as a concept.

So what happens to the `3Gi` you put in your PVC? It's stored. It's reported back when you `kubectl get pvc`. And it is **completely ignored** by the part of the system that actually controls writes.

The [AWS EFS CSI driver project](https://github.com/kubernetes-sigs/aws-efs-csi-driver) is clear about this in its examples and docs: the `storage` field is required by the Kubernetes PVC API but has no effect for EFS-backed volumes — EFS scales automatically to whatever the filesystem needs.

It's a required field in the Kubernetes PVC API contract — you can't `kubectl apply` a PVC without it — but the EFS provisioner just shrugs.

## Why Kubernetes Doesn't Enforce It Either 🔓

You might think: *fine, the CSI driver doesn't enforce a quota — but surely kubelet does? Doesn't kubelet know the PVC asked for 3Gi and clamp the writes?*

No. **kubelet doesn't enforce storage quotas on PVC mounts.** Its job is to take the mount instructions from the CSI driver and present them to the container. Quota enforcement, if any, has to come from the storage system itself.

For EBS that's automatic — the block device is finite, the filesystem layer on top fails writes when full. No software needs to intervene.

For EFS, the storage system is a shared filesystem with no per-Access-Point quota concept. So... nothing enforces it. The pod has the same write permissions as anyone with write access to that subdirectory on the EFS filesystem, and the filesystem itself is essentially unbounded.

## The Smoking Gun 🔫

Here's what the pod sees when you `df` inside it on an EFS-backed PVC:

```bash
$ kubectl -n agrifrontier-in exec deploy/agrifrontier-in-wordpress -c wordpress -- \
    df -h /bitnami/wordpress

Filesystem            Size  Used Avail Use% Mounted on
127.0.0.1:/wordpress  8.0E   26G  8.0E   1% /bitnami/wordpress
```

**8.0E.** Eight exabytes available. (`E` is exa- in `df`'s human-readable output.) Not 3 GiB. Not 30 GiB. Eight billion gigabytes.

That `127.0.0.1:/wordpress` mount is the efs-csi-driver's local NFS proxy. The actual filesystem behind it is the shared EFS instance, and 8 EB is how `df` represents "effectively unlimited."

Meanwhile the PVC still reports:

```bash
$ kubectl -n agrifrontier-in get pvc
NAME                        STATUS   VOLUME       CAPACITY   ACCESS MODES
agrifrontier-in-wordpress   Bound    pvc-xxx...   3Gi        RWX
```

CAPACITY: 3Gi. The actual data sitting in that mount is 5.8 GB. There is no `3Gi` boundary anywhere except in this metadata.

## So Why Is the Field There at All? 🤷

Because the `PersistentVolumeClaim` schema demands it. The K8s API requires `spec.resources.requests.storage` to be a non-empty quantity. The schema doesn't have a way to say "this storage class doesn't have a size concept." So you fill in some number, the CSI driver politely accepts it, and life goes on.

You can think of it like a form field on a website that's required but the backend never reads. You can't submit the form blank, but the value you put in goes into the void.

## What This Means in Practice 📋

A few things, in order of importance:

**1. Don't bump the PVC `storage` value for EFS PVCs in hopes of "giving the pod more space."** It does nothing. You already have all the space EFS has, which is effectively unlimited. The only thing changing the value affects is what `kubectl get pvc` displays — and even that doesn't roll-forward gracefully (you can `expand` a PVC's storage value but it's a no-op for EFS).

**2. Don't trust dashboards that color-code your PVCs based on the "capacity" field.** Grafana panels, Lens, k9s — most of them surface the PVC capacity as if it were the real ceiling. For EFS-backed PVCs, that 95%-full warning is meaningless.

**3. The real EFS limits you should watch:**
   - **Throughput**: bursting mode has credits; if you read/write hard enough, you'll throttle. Move to elastic or provisioned throughput if it becomes a problem.
   - **IOPS**: EFS has per-filesystem limits in the tens of thousands; for typical WordPress workloads, irrelevant. For ML training, watch it.
   - **Cost per GB-month**: One Zone IA is ~$0.0045/GiB-month, Standard is ~$0.043/GiB-month. With Intelligent Tiering you usually settle close to IA pricing after a few weeks.

**4. The 3Gi number on the PVC has the same effect as setting `--memory 9999G` on a Docker container with no enforcement: it's a hint to the human reading the manifest, nothing more.**

**5. None of this applies to EBS.** If your PVC spec says `3Gi` and your StorageClass is `gp3` or `gp2` or `io1`, that is a real 3 GiB EBS volume and you absolutely will hit ENOSPC. The cosmetic-field behavior is specific to drivers that provision a directory/permission on a shared filesystem rather than a fixed-size object — EFS with `efs-ap` mode is the canonical example.

## A Mental Quick Test ✅

Next time you spec a PVC, ask: *what does the CSI driver actually do with the `storage` field?*

- **CSI driver provisions a fixed-size object** (block volume, FSx volume with explicit size, etc.) → field is enforced.
- **CSI driver provisions a directory or access point on a shared filesystem** → field is cosmetic.

Knowing which side of the line you're on changes how you reason about "running out of space" alerts, capacity planning, and disaster recovery sizing.

## Bonus: Demonstrating This in Your Own Cluster 🧪

If you want to convince yourself with one command, pick any EFS-backed PVC in your cluster and run:

```bash
NS=<your-namespace>
DEPLOY=<your-deployment>

# What the PVC claims:
kubectl -n $NS get pvc -o custom-columns=NAME:.metadata.name,CAPACITY:.status.capacity.storage

# What the pod actually sees:
kubectl -n $NS exec deploy/$DEPLOY -- df -h /path/to/efs/mount
```

If the second number is "8.0E" or some petabyte figure, congratulations: your PVC's `storage` field is decorative. Write to your heart's content.

---

*This came up while I was migrating WordPress sites onto EFS-backed shared storage. Happy to chat about EFS migrations or EKS storage on [LinkedIn](https://www.linkedin.com/in/dhruvchavda/) — the kind of thing that doesn't show up in tutorials but bites you on production day.*
