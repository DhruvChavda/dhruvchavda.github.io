---
title: "GitLab Disaster Recovery: Restoring from a Backup Volume"
description: "A complete guide to restoring a self-hosted GitLab instance from a backup volume, with automated scripts and manual steps."
pubDate: 2026-01-10
category: "Tutorials"
tags: ["gitlab", "disaster-recovery", "backup", "restore", "devops", "ubuntu"]
draft: false
---

## Why This Guide Exists

GitLab's official docs cover `gitlab-backup restore`, the tar-based approach. It works, but it's slow, doesn't include config or secrets, and requires you to have a working GitLab instance *before* you can restore into it. When your server is dead and you're staring at a backup volume at 3 AM, the last thing you want is to piece together a restore process from five different doc pages.

This guide covers the **volume-based restore approach**: a faster, more complete alternative that I've used in real disaster recovery scenarios. Every command, every permission, every gotcha is documented here because I've hit them all personally. If you haven't set up GitLab yet, start with my [installation guide](/blogs/self-hosting-gitlab-ee-installation-guide) first. It covers the initial setup and backup volume configuration that this guide assumes you already have.

## When Disaster Strikes

Nobody thinks about disaster recovery until they need it. And by then, it's usually too late to figure out the details.

I've been through two GitLab recovery scenarios now: one planned (migrating to a bigger server) and one unplanned (cloud provider disk corruption). The planned one went smoothly because we had scripts and a tested process. The unplanned one was a stressful 3 AM scramble that exposed every gap in our documentation. This guide exists so that neither you nor I ever have to go through that again.

We use a **volume-based backup approach**. Instead of GitLab's built-in `gitlab-backup create` (which produces a tar archive), we continuously sync the entire GitLab data directory to a separate mounted volume. This means our backup contains everything: repositories, the database, configuration, secrets, SSL certificates, and logs. The restore process is essentially "attach the volume to a fresh server, install the same GitLab version, and point it at the data."

It's simpler than it sounds, but the details matter. Let's go through all of them.

## Understanding the Backup Volume

Before jumping into the restore process, you need to understand what's on the backup volume and where it maps to on a running GitLab instance.

```
/mnt/gitlab-data/
├── gitlab/              →  /var/opt/gitlab (all GitLab data)
│   ├── gitlab-rails/
│   │   ├── VERSION      ← GitLab version that created this data
│   │   ├── uploads/     ← user-uploaded files
│   │   └── shared/      ← shared files (pages, artifacts, LFS)
│   ├── git-data/
│   │   └── repositories/ ← all Git repositories
│   ├── postgresql/
│   │   └── data/        ← PostgreSQL database
│   ├── redis/           ← Redis cache (safe to lose)
│   ├── gitlab-workhorse/ ← temp files for HTTP uploads
│   └── .ssh/
│       └── authorized_keys ← SSH keys for Git over SSH
├── etc-gitlab/          →  /etc/gitlab (configuration)
│   ├── gitlab.rb        ← main configuration file
│   ├── gitlab-secrets.json ← encryption keys (CRITICAL)
│   └── ssl/             ← SSL certificates
└── var-log-gitlab/      →  /var/log/gitlab (service logs)
```

### The Critical File: `gitlab-secrets.json`

This file contains the encryption keys for:
- **CI/CD variables:** all those secret environment variables in your pipelines
- **Two-factor authentication (2FA) keys:** every user's TOTP secret
- **Runner authentication tokens:** how your CI runners authenticate with GitLab
- **Database encryption keys:** used for encrypting sensitive columns

If you lose `gitlab-secrets.json`, **all encrypted data becomes permanently unrecoverable**. There is no way to regenerate these keys. This is the single most important file in your backup.

### The VERSION File

Located at `gitlab/gitlab-rails/VERSION`, this file contains the exact GitLab version that was running when the backup was created (e.g., `18.7.0-ee`). You **must** install this exact version on the new server. Version mismatches, even minor ones, can corrupt the database or cause data loss.

## Prerequisites

You'll need:

- **A fresh Ubuntu 22.04 or 24.04 LTS instance.** Don't try to restore onto a server that already has GitLab installed. Start clean.
- **The backup volume** attached to the new instance. This is typically a block storage volume from your cloud provider that was detached from the old server.
- **Root or sudo access** on the new instance.
- **Internet access:** needed to download the GitLab package.
- **DNS record:** either update the A record to point to the new server, or use the `--url` flag during restore if the domain is different.
- **Enough disk space:** the root volume should have at least as much free space as the backup volume uses, plus 20% buffer.

Quick pre-check:

```bash
# Check you're on Ubuntu LTS
cat /etc/os-release | grep VERSION_ID

# Check disk space
df -h /

# Check RAM (minimum 4GB, recommended 8GB+)
free -h

# Verify internet access
curl -s --max-time 5 https://packages.gitlab.com > /dev/null && echo "OK" || echo "FAIL"
```

## Step 1: Mount the Backup Volume

First, identify and mount the backup volume.

### Identify the Volume

```bash
lsblk
```

Look for the volume that isn't your root disk. It's usually `/dev/sdb`, `/dev/vdb`, or `/dev/xvdf` depending on your cloud provider.

### Mount It

```bash
sudo mkdir -p /mnt/gitlab-data
sudo mount /dev/sdb /mnt/gitlab-data
```

### Add to fstab for Persistence

Get the UUID so the mount survives reboots:

```bash
sudo blkid /dev/sdb
```

Add the entry to fstab:

```bash
echo 'UUID=<YOUR-VOLUME-UUID> /mnt/gitlab-data ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab
```

The `nofail` option is important. It prevents the system from failing to boot if the volume is temporarily unavailable.

### Verify the Structure

```bash
ls -la /mnt/gitlab-data/
```

Expected output:

```
drwxr-xr-x  gitlab/
drwxr-xr-x  etc-gitlab/
drwxr-xr-x  var-log-gitlab/
```

Verify the critical files exist:

```bash
# GitLab version
cat /mnt/gitlab-data/gitlab/gitlab-rails/VERSION

# Configuration
ls -la /mnt/gitlab-data/etc-gitlab/gitlab.rb
ls -la /mnt/gitlab-data/etc-gitlab/gitlab-secrets.json

# Repositories exist
ls /mnt/gitlab-data/gitlab/git-data/repositories/
```

If any of these are missing, your backup is incomplete and you should not proceed until you have a complete backup.

## Step 2: Run the Prerequisites Check

Before running the actual restore, use the prerequisites check script to validate your environment. This script is read-only and doesn't modify anything on the system.

```bash
sudo ./gitlab-restore-prerequisites.sh
```

Or if you're restoring to a different domain:

```bash
sudo ./gitlab-restore-prerequisites.sh --url https://gitlab.example.com
```

### What It Checks

The script runs four categories of checks:

**System checks:**
- Root privileges
- Disk space (minimum 20 GB free)
- Available RAM (minimum 4 GB)
- Internet connectivity to packages.gitlab.com

**Backup volume checks:**
- Mount path exists and is accessible
- Required directory structure (`gitlab/`, `etc-gitlab/`, `var-log-gitlab/`)
- VERSION file exists and is readable
- `gitlab.rb` exists
- `gitlab-secrets.json` exists
- `authorized_keys` file present
- Backup volume size sanity check

**SSL/Certificate checks:**
- Manual SSL certs existence in backup
- Certificate expiry dates
- Certbot/Let's Encrypt configuration status

**Network checks:**
- DNS resolution for the target domain
- DNS-to-server IP match
- Port 80 and 443 availability

### Interpreting the Output

Each check shows one of three statuses:
- **PASS:** check passed, good to go
- **WARN:** non-critical issue, restore will likely work but something may need attention
- **FAIL:** critical issue, do not proceed until resolved

Example output:

```
=== System Checks ===
[PASS] Running as root
[PASS] Disk space: 85GB free
[PASS] RAM: 16GB available
[PASS] Internet connectivity: OK

=== Backup Volume Checks ===
[PASS] Mount path: /mnt/gitlab-data
[PASS] Directory structure: valid
[PASS] VERSION file: 18.7.0-ee
[PASS] gitlab.rb: found
[PASS] gitlab-secrets.json: found
[WARN] authorized_keys: not found in backup
[PASS] Backup volume size: 45GB

=== SSL Checks ===
[PASS] Manual certs found: gitlab.example.com.crt
[PASS] Certificate expiry: 2026-06-15 (91 days remaining)

=== Network Checks ===
[PASS] DNS resolution: gitlab.example.com → 203.0.113.10
[PASS] Port 80: available
[PASS] Port 443: available
```

If you see any **FAIL** results, fix them before continuing. **WARN** results are informational. For example, a missing `authorized_keys` just means Git-over-SSH won't work until users add their SSH keys through the web UI.

## Step 3: Automated Restore (Script)

The restore script handles the entire process automatically. It has six phases and includes safety checks at each step. Both scripts (`gitlab-restore.sh` and `gitlab-restore-prerequisites.sh`) are open-sourced on GitHub at [gitlab-scripts](https://github.com/DhruvChavda/gitlab-scripts).

### Usage

```bash
# Basic restore
sudo ./gitlab-restore.sh

# Non-interactive (skip all confirmations)
sudo ./gitlab-restore.sh --yes

# Restore to a different domain
sudo ./gitlab-restore.sh --yes --url https://gitlab-new.example.com

# Skip post-restore validation (faster, run checks manually later)
sudo ./gitlab-restore.sh --yes --skip-validation

# Debug mode (verbose output for troubleshooting)
sudo ./gitlab-restore.sh --debug --yes
```

### Available Flags

| Flag | Description |
|------|-------------|
| `-h`, `--help` | Show usage information |
| `--yes` | Skip interactive confirmations |
| `--url <url>` | Override the external_url (for restoring to a different domain) |
| `--skip-validation` | Skip Phase 6 post-restore rake tasks |
| `--debug` | Enable verbose output (set -x) |

### Phase-by-Phase Walkthrough

#### Phase 1: Pre-flight Checks

The script verifies:
- Running as root
- Backup volume is mounted and accessible
- VERSION file exists and is readable
- `gitlab.rb` and `gitlab-secrets.json` are present
- Sufficient disk space on the root volume

If any check fails, the script exits with a clear error message.

#### Phase 2: Version Detection and GitLab Installation

The script reads the VERSION file to determine the exact GitLab version:

```
[INFO] Detected GitLab version from backup: 18.7.0-ee
[INFO] Edition: EE (Enterprise Edition)
[INFO] APT package version: gitlab-ee=18.7.0-ee.0
```

It then:
1. Adds the GitLab apt repository (if not already added)
2. Installs the exact version with `GITLAB_SKIP_RECONFIGURE=1` to prevent auto-configuration before the data is in place
3. If a different version of GitLab is already installed, it purges it first to prevent conflicts

#### Phase 3: Filesystem Setup (Symlinks)

Instead of copying the data (which would double your disk usage), the script creates **symlinks** from GitLab's standard paths to the backup volume:

```
/var/opt/gitlab  →  /mnt/gitlab-data/gitlab
/etc/gitlab      →  /mnt/gitlab-data/etc-gitlab
/var/log/gitlab  →  /mnt/gitlab-data/var-log-gitlab
```

If the original directories exist, the script backs them up first (e.g., `/var/opt/gitlab.bak.20260110`).

#### Phase 4: Permissions

File ownership is critical for GitLab to function. The script sets correct permissions on all directories:

```
git:git         → /var/opt/gitlab/git-data
git:git         → /var/opt/gitlab/gitlab-rails
git:git         → /var/opt/gitlab/gitlab-rails/uploads
git:git         → /var/opt/gitlab/gitlab-rails/shared
git:gitlab-www  → /var/opt/gitlab/gitlab-workhorse
git:git         → /var/opt/gitlab/gitlab-pages
gitlab-psql     → /var/opt/gitlab/postgresql
gitlab-redis    → /var/opt/gitlab/redis
git:git         → /var/opt/gitlab/.ssh/authorized_keys (mode 600)
root:root       → /etc/gitlab (mode 0775)
root:root       → /etc/gitlab/gitlab-secrets.json (mode 0600)
```

#### Phase 5: Reconfigure and Start

This is the most complex phase. The script:

1. **Kills stale processes.** If any runit/runsvdir processes are left over from a previous GitLab install, they'll block reconfigure. The script force-kills them:

```bash
pkill -9 runsvdir 2>/dev/null || true
pkill -9 runsv 2>/dev/null || true
```

2. **Cleans runtime files.** Removes stale PID files, socket files, and Redis dumps that would prevent services from starting:

```bash
rm -f /var/opt/gitlab/redis/redis.pid
rm -f /var/opt/gitlab/redis/dump.rdb
rm -f /var/opt/gitlab/postgresql/.s.PGSQL.*
```

3. **Backs up `gitlab.rb`** before any domain replacement (saved as `gitlab.rb.pre-restore-<timestamp>`)

4. **Replaces the domain.** If you used `--url`, it runs a global find-and-replace in `gitlab.rb` to update all domain references (external_url, SAML URLs, OAuth redirect URIs)

5. **Runs `gitlab-ctl reconfigure`** to apply all configuration and start services

6. **Runs `gitlab-ctl restart`** to ensure all services are fully restarted with the new configuration

7. **Health check:** waits for GitLab to respond on its configured URL

#### Phase 6: Post-Restore Data Validation

Unless you pass `--skip-validation`, the script runs several rake tasks to verify data integrity:

```
[INFO] Checking database migrations...
[INFO] All database migrations are up.
[INFO] Running repository integrity check...
[INFO] Running artifact integrity check...
[INFO] Running LFS integrity check...
[INFO] Running upload integrity check...
[INFO] Post-restore validation complete.
```

These checks can take a while on large instances (especially `gitlab:git:fsck` which verifies every repository). Use `--skip-validation` if you need a fast restore and plan to run these manually later.

## Step 4: Manual Restore (Step-by-Step)

If the script isn't available, or you need to troubleshoot a specific phase, here's the complete manual process.

### 4.1: Detect the GitLab Version

```bash
cat /mnt/gitlab-data/gitlab/gitlab-rails/VERSION
```

Note the output exactly, for example `18.7.0-ee`. The `-ee` suffix means Enterprise Edition.

### 4.2: Install the Exact GitLab Version

Add the repository and install:

```bash
# Add GitLab repo
curl -fsSL https://packages.gitlab.com/install/repositories/gitlab/gitlab-ee/script.deb.sh | sudo bash

# Install the exact version WITHOUT running reconfigure
sudo EXTERNAL_URL="https://gitlab.example.com" GITLAB_SKIP_RECONFIGURE=1 apt-get install -y gitlab-ee=18.7.0-ee.0
```

**Important:** The APT version format appends `.0` to the version from the VERSION file. So `18.7.0-ee` becomes `18.7.0-ee.0`.

### 4.3: Stop GitLab and Back Up Existing Directories

```bash
# Stop all GitLab services
sudo gitlab-ctl stop

# Back up the freshly installed directories (just in case)
TIMESTAMP=$(date +%Y%m%d%H%M%S)
sudo mv /var/opt/gitlab /var/opt/gitlab.bak.$TIMESTAMP
sudo mv /etc/gitlab /etc/gitlab.bak.$TIMESTAMP
sudo mv /var/log/gitlab /var/log/gitlab.bak.$TIMESTAMP
```

### 4.4: Create Symlinks

Link GitLab's expected paths to the backup volume:

```bash
sudo ln -s /mnt/gitlab-data/gitlab /var/opt/gitlab
sudo ln -s /mnt/gitlab-data/etc-gitlab /etc/gitlab
sudo ln -s /mnt/gitlab-data/var-log-gitlab /var/log/gitlab
```

Verify the symlinks:

```bash
ls -la /var/opt/gitlab
ls -la /etc/gitlab
ls -la /var/log/gitlab
```

Each should show `->` pointing to the corresponding path under `/mnt/gitlab-data/`.

### 4.5: Fix Permissions

This step is critical. Incorrect permissions are the #1 cause of post-restore failures.

```bash
# Configuration directory
sudo chown -R root:root /etc/gitlab
sudo chmod 0775 /etc/gitlab
sudo chmod 0600 /etc/gitlab/gitlab-secrets.json

# Git data (repositories)
sudo chown -R git:git /var/opt/gitlab/git-data
sudo chmod 2770 /var/opt/gitlab/git-data/repositories

# Rails data (uploads, shared files)
sudo chown -R git:git /var/opt/gitlab/gitlab-rails
sudo chown -R git:git /var/opt/gitlab/gitlab-rails/uploads
sudo chown -R git:git /var/opt/gitlab/gitlab-rails/shared

# Workhorse
sudo chown -R git:gitlab-www /var/opt/gitlab/gitlab-workhorse

# Pages
sudo chown -R git:git /var/opt/gitlab/gitlab-pages 2>/dev/null || true

# PostgreSQL
sudo chown -R gitlab-psql:gitlab-psql /var/opt/gitlab/postgresql

# Redis
sudo chown -R gitlab-redis:gitlab-redis /var/opt/gitlab/redis

# SSH keys
if [ -f /var/opt/gitlab/.ssh/authorized_keys ]; then
  sudo chown git:git /var/opt/gitlab/.ssh/authorized_keys
  sudo chmod 600 /var/opt/gitlab/.ssh/authorized_keys
fi
```

### 4.6: Kill Stale Processes

If GitLab was previously installed (even briefly during the package install), runit processes may be lingering:

```bash
# Check for stale processes
ps aux | grep -E 'runsvdir|runsv|gitlab' | grep -v grep

# Kill them all
sudo pkill -9 runsvdir 2>/dev/null || true
sudo pkill -9 runsv 2>/dev/null || true
sudo pkill -9 -f 'gitlab' 2>/dev/null || true

# Wait a moment for processes to die
sleep 3

# Verify they're gone
ps aux | grep -E 'runsvdir|runsv' | grep -v grep
```

This is the "nuclear option" and it's intentional. Stale runit processes will hold locks that prevent `gitlab-ctl reconfigure` from running correctly. Graceful shutdown (`kill -15`) doesn't work reliably with runit in this scenario, so you need SIGKILL.

### 4.7: Clean Runtime Files

Remove stale PID files, socket files, and Redis dumps:

```bash
# Redis
sudo rm -f /var/opt/gitlab/redis/redis.pid
sudo rm -f /var/opt/gitlab/redis/dump.rdb

# PostgreSQL sockets
sudo rm -f /var/opt/gitlab/postgresql/.s.PGSQL.*

# Puma/Workhorse PID files
sudo rm -f /var/opt/gitlab/gitlab-workhorse/socket
find /var/opt/gitlab -name "*.pid" -exec sudo rm -f {} \; 2>/dev/null || true
```

### 4.8: Domain Replacement (If Restoring to a Different URL)

If the new server uses a different domain than the original, update all references in `gitlab.rb`:

```bash
# Back up first
sudo cp /etc/gitlab/gitlab.rb /etc/gitlab/gitlab.rb.pre-restore

# Replace all occurrences of the old domain
sudo sed -i 's|old-gitlab.example.com|new-gitlab.example.com|g' /etc/gitlab/gitlab.rb

# Verify the changes
grep -n 'new-gitlab.example.com' /etc/gitlab/gitlab.rb
```

This catches:
- `external_url`
- SAML `assertion_consumer_service_url` and `issuer`
- OAuth redirect URIs
- Any other domain references in the config

### 4.9: Reconfigure and Start

```bash
# Run reconfigure
sudo gitlab-ctl reconfigure

# Restart all services
sudo gitlab-ctl restart

# Check status
sudo gitlab-ctl status
```

Reconfigure takes 3-5 minutes. You'll see a long stream of Chef recipe output. This is normal. Watch for any red error lines.

### 4.10: Health Check

```bash
# Wait for GitLab to be ready (can take 2-5 minutes)
sudo gitlab-rake gitlab:check SANITIZE=true

# Quick HTTP check
curl -sI https://gitlab.example.com | head -5
```

## Step 5: Post-Restore Verification Checklist

After the restore completes (whether via script or manual), run through this checklist to verify everything is working.

### Service Status

```bash
sudo gitlab-ctl status
```

All services should show `run`. Count them: a typical GitLab EE instance has 15-17 services.

### Comprehensive Health Check

```bash
sudo gitlab-rake gitlab:check SANITIZE=true
```

Every check should pass. Pay attention to any warnings.

### Database Migrations

```bash
sudo gitlab-rake db:migrate:status | grep down
```

This should return no output. If there are pending (`down`) migrations:

```bash
sudo gitlab-rake db:migrate
```

### Repository Integrity

```bash
sudo gitlab-rake gitlab:git:fsck
```

This verifies the integrity of all Git repositories. On large instances with many repos, this can take 30+ minutes. If any repositories show errors, they may need to be repaired or restored individually.

### Artifacts, LFS, and Uploads

```bash
sudo gitlab-rake gitlab:artifacts:check
sudo gitlab-rake gitlab:lfs:check
sudo gitlab-rake gitlab:uploads:check
```

These verify that all artifact, LFS object, and upload files referenced in the database actually exist on disk.

### Functional Tests

Beyond the automated checks, manually verify:

1. **Web UI:** open the GitLab URL in a browser, log in with an existing account
2. **SSO login:** if SAML/OAuth is configured, test the SSO flow end-to-end
3. **Git clone:** clone a repository over HTTPS and SSH:

```bash
git clone https://gitlab.example.com/some-group/some-repo.git
git clone git@gitlab.example.com:some-group/some-repo.git
```

4. **Git push:** make a test commit and push it
5. **CI/CD:** trigger a pipeline and verify it runs successfully
6. **Container registry:** if using GitLab's container registry, try pulling an image

## Step 6: DNS and SSL

### Update DNS

Point your domain's A record to the new server's IP address. If you're using Cloudflare:

1. Log into Cloudflare dashboard
2. Update the A record for `gitlab.example.com` to the new server IP
3. If using Cloudflare proxy (orange cloud), set SSL mode to **Full (Strict)**

DNS propagation can take up to 48 hours, but with low TTL values it's usually under 5 minutes.

### Set Up Certbot on the New Server

If the old SSL certificates from the backup are still valid, you can use them temporarily. But you should set up fresh certificates on the new server:

```bash
# Install certbot
sudo apt install -y certbot

# Stop nginx temporarily
sudo gitlab-ctl stop nginx

# Obtain a new certificate
sudo certbot certonly --standalone -d gitlab.example.com

# Update gitlab.rb to point to the new certs
sudo nano /etc/gitlab/gitlab.rb
```

Update the SSL paths in `gitlab.rb`:

```ruby
letsencrypt['enable'] = false
nginx['ssl_certificate'] = "/etc/letsencrypt/live/gitlab.example.com/fullchain.pem"
nginx['ssl_certificate_key'] = "/etc/letsencrypt/live/gitlab.example.com/privkey.pem"
```

Apply and restart:

```bash
sudo gitlab-ctl reconfigure
sudo gitlab-ctl restart nginx
```

### Cloudflare Considerations

If you're behind Cloudflare proxy, watch out for these issues:

- **ERR_TOO_MANY_REDIRECTS:** this happens when Cloudflare's SSL mode is set to "Flexible" but GitLab is configured for HTTPS. Set Cloudflare SSL to **Full (Strict)**.
- **Certbot HTTP-01 challenge fails:** Cloudflare proxy intercepts the ACME challenge. Either temporarily disable proxy (grey cloud) during cert issuance, or use the DNS-01 challenge:

```bash
sudo apt install -y python3-certbot-dns-cloudflare
sudo certbot certonly --dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini -d gitlab.example.com
```

### Verify SSL

```bash
curl -sI https://gitlab.example.com | head -10
```

You should see `HTTP/2 200` or a `302` redirect to the login page.

## Troubleshooting

### Version Mismatch Errors

```
FATAL: GitLab version mismatch. Backup version: 18.7.0-ee, Installed: 18.8.0-ee
```

You must install the exact version from the backup. Check the VERSION file and install accordingly:

```bash
cat /mnt/gitlab-data/gitlab/gitlab-rails/VERSION
sudo apt-get install -y gitlab-ee=18.7.0-ee.0
```

### Redis Connection Refused

```
Redis::CannotConnectError: Error connecting to Redis on /var/opt/gitlab/redis/redis.socket
```

Redis's socket or PID file is stale. Fix:

```bash
sudo rm -f /var/opt/gitlab/redis/redis.pid
sudo rm -f /var/opt/gitlab/redis/dump.rdb
sudo gitlab-ctl restart redis
```

### Stale runit Processes

If `gitlab-ctl reconfigure` hangs or produces weird errors, stale runit processes are usually the culprit:

```bash
# Check
ps aux | grep runsvdir

# Kill everything
sudo pkill -9 runsvdir
sudo pkill -9 runsv
sleep 3

# Retry
sudo gitlab-ctl reconfigure
```

### PostgreSQL Won't Start

```
FATAL: data directory "/var/opt/gitlab/postgresql/data" has wrong ownership
```

Fix permissions:

```bash
sudo chown -R gitlab-psql:gitlab-psql /var/opt/gitlab/postgresql
sudo gitlab-ctl restart postgresql
```

If PostgreSQL complains about version mismatch (e.g., the backup was made with PostgreSQL 14 but the new GitLab bundles PostgreSQL 16), you may need to install the exact same GitLab version to get the matching PostgreSQL version. GitLab handles PostgreSQL upgrades during its own upgrade process, so you can't skip versions.

### ERR_TOO_MANY_REDIRECTS

This means the domain in `gitlab.rb` doesn't match what the browser is requesting, or Cloudflare SSL mode is wrong.

```bash
# Check external_url
grep external_url /etc/gitlab/gitlab.rb

# Make sure it matches your actual domain
# If behind Cloudflare, set SSL mode to Full (Strict)
```

### SAML/OAuth Redirects to Wrong Domain

After restoring to a different domain, SAML and OAuth URLs may still reference the old domain:

```bash
# Check for old domain references
grep -n 'old-domain.com' /etc/gitlab/gitlab.rb

# Replace them all
sudo sed -i 's|old-domain.com|new-domain.com|g' /etc/gitlab/gitlab.rb

# Reconfigure
sudo gitlab-ctl reconfigure
```

Don't forget to update the reply URL in your identity provider (Entra ID, Bitbucket, etc.) to match the new domain.

### Services Show "down" After Restore

```bash
sudo gitlab-ctl status
# Shows: down: puma: 0s, normally up
```

Check for stale PID and socket files:

```bash
find /var/opt/gitlab -name "*.pid" -exec ls -la {} \;
find /var/opt/gitlab -name "*.socket" -exec ls -la {} \;
```

Remove stale ones and restart:

```bash
find /var/opt/gitlab -name "*.pid" -exec sudo rm -f {} \; 2>/dev/null
sudo gitlab-ctl restart
```

### authorized_keys Missing (Git SSH Not Working)

If Git-over-SSH doesn't work after restore:

```bash
# Check if the file exists
ls -la /var/opt/gitlab/.ssh/authorized_keys
```

If it's missing, GitLab will regenerate it when users add SSH keys through the web UI. You can also force a rebuild:

```bash
sudo gitlab-rake gitlab:shell:setup
```

## Best Practices

- **Always run the prerequisites check first.** It takes 30 seconds and can save you hours of debugging.
- **Test your restore process on a staging instance.** Don't wait for an actual disaster to find out your backup is incomplete or your scripts have bugs. We run a restore drill quarterly.
- **Keep volume snapshots, not just live sync.** Rsync gives you a live copy, but if your data gets corrupted, the corruption syncs too. Cloud provider snapshots give you point-in-time recovery.
- **Document the backup volume UUID.** When you're scrambling at 3 AM, you don't want to guess which volume to mount. Keep the UUID, mount point, and cloud provider volume ID in your runbook.
- **Protect `gitlab-secrets.json` above all else.** Consider keeping an extra encrypted copy outside your primary backup. If the backup volume itself fails, this is the one file you absolutely cannot lose.
- **Don't use `--skip-validation` for real disaster recovery.** The validation rake tasks exist to catch data integrity issues early. Skip them only for testing or when you plan to run them manually afterward.
- **Run regular DR drills.** Restore to a test server at least once a quarter. The process should be boring and predictable. If it's exciting, your documentation needs work.
- **Keep the restore scripts on the backup volume.** Store `gitlab-restore.sh` and `gitlab-restore-prerequisites.sh` directly on the backup volume at `/mnt/gitlab-data/gitlab-restore/`. That way, when you mount the volume on a fresh server, everything you need is right there.

## Key Takeaways

- **Version matching is non-negotiable.** Install the exact GitLab version from the backup's VERSION file. No exceptions.
- **`gitlab-secrets.json` is irreplaceable.** Lose it and all encrypted data (CI vars, 2FA, runner tokens) is gone forever.
- The **volume-based backup approach** (symlinks to a mounted volume) is simpler and faster than `gitlab-backup restore` for full-instance recovery.
- **Stale runit processes** are the most common cause of restore failures. Kill them with SIGKILL, because graceful shutdown doesn't work in this scenario.
- **Permissions matter.** Incorrect ownership on PostgreSQL, Redis, or Git data directories will prevent services from starting. The permission list in Step 4.5 covers everything.
- **Test your DR process regularly.** A backup you've never restored from is just a hope, not a plan.

If you haven't set up your backup volume yet, check out my previous post on [self-hosting GitLab](/blogs/self-hosting-gitlab-ee-installation-guide). Step 6 covers the complete backup setup. And if you want to grab the scripts directly, they're on GitHub at [gitlab-scripts](https://github.com/DhruvChavda/gitlab-scripts).
