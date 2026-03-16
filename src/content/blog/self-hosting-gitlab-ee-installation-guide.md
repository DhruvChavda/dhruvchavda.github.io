---
title: "Self-Hosting GitLab EE: A Complete Installation Guide for Ubuntu"
description: "A comprehensive, step-by-step guide to installing GitLab Enterprise Edition on Ubuntu LTS with Certbot SSL, backups, and SSO."
pubDate: 2025-12-15
category: "Tutorials"
tags: ["gitlab", "self-hosted", "devops", "ubuntu", "ssl", "certbot"]
draft: false
---

## Why This Guide Exists

GitLab's official installation docs are fine. They'll get you from zero to a running instance. But they're also scattered across dozens of pages, assume you already know which options to pick, and leave out the parts where things actually go wrong. I spent more time jumping between tabs and Stack Overflow threads than actually installing GitLab the first time around.

This guide is what I wish I had when I started. It's a **single, linear walkthrough** based on real production experience, not a collection of reference pages. Every command here has been run on actual servers, and the troubleshooting section covers errors I've personally hit (and fixed) in production. If something can bite you, I've called it out.

## Why Self-Host GitLab?

There are plenty of managed Git hosting options out there: GitHub, GitLab SaaS, Bitbucket Cloud. They're convenient, well-maintained, and require zero infrastructure work. So why would anyone choose to run their own GitLab instance?

For us, it came down to three things: **control**, **compliance**, and **cost**. We needed full ownership of our source code and CI/CD data, the ability to configure authentication exactly how we wanted (SAML SSO with our identity provider), and at our scale, the self-hosted license was significantly cheaper than per-seat SaaS pricing.

Running a self-hosted GitLab instance isn't trivial, but it's far from rocket science either. This guide walks through every step of setting up GitLab Enterprise Edition on a fresh Ubuntu LTS server, from initial system prep all the way through SSL, backups, and SSO configuration.

## Prerequisites

Before you start, make sure you have the following ready:

- **A fresh Ubuntu server:** Ubuntu 22.04 LTS or 24.04 LTS. Don't install GitLab on a server that's already running other services.
- **Minimum hardware:** 4 vCPUs, 8 GB RAM, 50 GB disk. For production use with 50+ users, I'd recommend **8 vCPUs, 16 GB RAM, and 100+ GB disk**.
- **A DNS A record** pointing your desired domain (e.g., `gitlab.example.com`) to the server's public IP. This needs to be set up before you start, since SSL certificate generation depends on it.
- **Root or sudo access** on the server.
- **Internet access:** the server needs to download packages from GitLab's repository and apt mirrors.
- **(Optional)** SMTP credentials if you want email notifications, and SAML IdP details if you're setting up SSO.

Here's a quick checklist to verify before proceeding:

```bash
# Verify Ubuntu version
cat /etc/os-release | grep VERSION_ID

# Check available resources
nproc          # CPU cores
free -h        # RAM
df -h /        # Disk space

# Verify DNS resolution (from another machine)
dig gitlab.example.com +short
```

## Step 1: System Preparation

Start by updating the system and installing the dependencies that GitLab requires.

```bash
sudo apt update && sudo apt upgrade -y
```

Install the required packages:

```bash
sudo apt install -y curl openssh-server ca-certificates tzdata perl postfix
```

When `postfix` prompts you during installation, select **"Internet Site"** and enter your server's domain name. If you plan to use an external SMTP service (like SendGrid or AWS SES), you can skip postfix and configure SMTP directly in GitLab later.

### Configure the Firewall

If UFW (Uncomplicated Firewall) is enabled, open the necessary ports:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Port 80 is required for Certbot's HTTP-01 challenge during SSL certificate issuance, even though GitLab will ultimately serve traffic on 443.

## Step 2: Add the GitLab Repository

GitLab provides an official package repository. Add it with:

```bash
curl -fsSL https://packages.gitlab.com/install/repositories/gitlab/gitlab-ee/script.deb.sh | sudo bash
```

This script adds GitLab's apt repository and GPG key to your system. You can verify it was added correctly:

```bash
apt-cache policy gitlab-ee
```

You should see available versions listed from the `packages.gitlab.com` repository.

## Step 3: Install GitLab EE

Now install GitLab. The `EXTERNAL_URL` environment variable tells GitLab what domain it should use:

```bash
sudo EXTERNAL_URL="https://gitlab.example.com" apt-get install -y gitlab-ee
```

This installs the latest version of GitLab EE, runs `gitlab-ctl reconfigure` automatically, and starts all services. The entire process takes 5-10 minutes depending on your server's specs.

### Installing a Specific Version

If you need a specific version (for example, to match an existing backup or stay on a tested release):

```bash
sudo EXTERNAL_URL="https://gitlab.example.com" apt-get install -y gitlab-ee=18.7.0-ee.0
```

The version format is `MAJOR.MINOR.PATCH-EDITION.REVISION`, so GitLab EE 18.7.0 becomes `gitlab-ee=18.7.0-ee.0`.

### Skipping Auto-Reconfigure

If you want to install GitLab but configure it manually before the first reconfigure (useful when you need to set up SSL certs or modify `gitlab.rb` first):

```bash
sudo GITLAB_SKIP_RECONFIGURE=1 EXTERNAL_URL="https://gitlab.example.com" apt-get install -y gitlab-ee
```

This installs the package without running `gitlab-ctl reconfigure`. You'll need to run it manually later after configuring everything.

## Step 4: SSL/TLS with Certbot

GitLab has a built-in Let's Encrypt integration, but I prefer using **Certbot** directly. It gives you more control over certificate management, works better when you're behind a CDN like Cloudflare, and makes it easier to troubleshoot certificate issues.

### Install Certbot

```bash
sudo apt install -y certbot
```

### Obtain the Certificate

Before running Certbot, make sure GitLab's nginx isn't already running on port 80 (it will be if you didn't use `GITLAB_SKIP_RECONFIGURE`). Stop it temporarily:

```bash
sudo gitlab-ctl stop nginx
```

Now obtain the certificate using standalone mode:

```bash
sudo certbot certonly --standalone -d gitlab.example.com
```

Certbot will:
1. Start a temporary web server on port 80
2. Verify domain ownership via HTTP-01 challenge
3. Save the certificate and private key

The certs are saved to:
- **Certificate:** `/etc/letsencrypt/live/gitlab.example.com/fullchain.pem`
- **Private key:** `/etc/letsencrypt/live/gitlab.example.com/privkey.pem`

### Configure GitLab to Use Certbot Certs

Edit `/etc/gitlab/gitlab.rb` and add these lines:

```ruby
# Disable GitLab's built-in Let's Encrypt
letsencrypt['enable'] = false

# Point to Certbot's certificates
nginx['ssl_certificate'] = "/etc/letsencrypt/live/gitlab.example.com/fullchain.pem"
nginx['ssl_certificate_key'] = "/etc/letsencrypt/live/gitlab.example.com/privkey.pem"
```

### Set Up Auto-Renewal

Certbot's auto-renewal needs to temporarily stop GitLab's nginx to free up port 80. Create a renewal hook:

```bash
sudo mkdir -p /etc/letsencrypt/renewal-hooks/pre
sudo mkdir -p /etc/letsencrypt/renewal-hooks/post
```

```bash
# Pre-hook: stop nginx before renewal
cat << 'EOF' | sudo tee /etc/letsencrypt/renewal-hooks/pre/stop-gitlab-nginx.sh
#!/bin/bash
gitlab-ctl stop nginx
EOF

# Post-hook: start nginx after renewal
cat << 'EOF' | sudo tee /etc/letsencrypt/renewal-hooks/post/start-gitlab-nginx.sh
#!/bin/bash
gitlab-ctl start nginx
EOF

sudo chmod +x /etc/letsencrypt/renewal-hooks/pre/stop-gitlab-nginx.sh
sudo chmod +x /etc/letsencrypt/renewal-hooks/post/start-gitlab-nginx.sh
```

Test the renewal process:

```bash
sudo certbot renew --dry-run
```

Certbot installs a systemd timer for auto-renewal by default. Verify it's active:

```bash
sudo systemctl status certbot.timer
```

### Verify the Certificate

```bash
sudo certbot certificates
```

You should see your domain, expiry date, and certificate paths listed.

## Step 5: Core Configuration

GitLab's entire configuration lives in a single file: `/etc/gitlab/gitlab.rb`. This is the file you'll come back to for virtually every configuration change.

### Essential Settings

Open the file:

```bash
sudo nano /etc/gitlab/gitlab.rb
```

Here are the key settings to configure:

```ruby
# The URL users will use to access GitLab
external_url 'https://gitlab.example.com'

# Puma (application server) settings
# Adjust based on your server's CPU and RAM
puma['worker_processes'] = 4
puma['min_threads'] = 4
puma['max_threads'] = 4

# Workhorse (handles Git HTTP traffic and file uploads)
gitlab_workhorse['auth_backend'] = "http://localhost:8080"
```

### SMTP Configuration (Optional)

If you want GitLab to send emails (notifications, password resets, etc.):

```ruby
gitlab_rails['smtp_enable'] = true
gitlab_rails['smtp_address'] = "smtp.example.com"
gitlab_rails['smtp_port'] = 587
gitlab_rails['smtp_user_name'] = "gitlab@example.com"
gitlab_rails['smtp_password'] = "<YOUR_SMTP_PASSWORD>"
gitlab_rails['smtp_domain'] = "example.com"
gitlab_rails['smtp_authentication'] = "login"
gitlab_rails['smtp_enable_starttls_auto'] = true

gitlab_rails['gitlab_email_from'] = 'gitlab@example.com'
gitlab_rails['gitlab_email_reply_to'] = 'noreply@example.com'
```

### Monitoring Whitelist

GitLab bundles Prometheus and Grafana for monitoring. By default, the monitoring endpoints are only accessible locally. If you want to access them from specific IPs:

```ruby
gitlab_rails['monitoring_whitelist'] = ['127.0.0.0/8', '10.0.0.0/8']
```

### Apply the Configuration

After making changes, apply them:

```bash
sudo gitlab-ctl reconfigure
```

This command can take a few minutes. It configures all bundled services (PostgreSQL, Redis, Nginx, Puma, Sidekiq, Gitaly, etc.) based on your `gitlab.rb` settings. You'll see a long output of Chef recipes being applied. That's normal.

## Step 6: Set Up a Backup Volume

This is one of the most important steps that often gets skipped. Without a proper backup strategy, a disk failure or cloud instance termination means losing everything: repositories, issues, CI/CD pipelines, and user data.

### Attach and Format the Volume

If you have a separate block storage volume (recommended), attach it to your instance and format it:

```bash
# Identify the volume
lsblk

# Format it (only if it's a new, empty volume!)
sudo mkfs.ext4 /dev/sdb
```

### Mount the Volume

Create the mount point and mount it:

```bash
sudo mkdir -p /mnt/gitlab-data
sudo mount /dev/sdb /mnt/gitlab-data
```

### Add to fstab for Persistence

Get the volume's UUID and add it to fstab so it mounts automatically on reboot:

```bash
# Get the UUID
sudo blkid /dev/sdb

# Add to fstab
echo 'UUID=<YOUR-VOLUME-UUID> /mnt/gitlab-data ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab

# Verify fstab is valid (this will catch syntax errors)
sudo mount -a
```

### Create the Backup Directory Structure

Set up the directories that will mirror GitLab's data layout:

```bash
sudo mkdir -p /mnt/gitlab-data/gitlab
sudo mkdir -p /mnt/gitlab-data/etc-gitlab
sudo mkdir -p /mnt/gitlab-data/var-log-gitlab
```

The mapping is:
- `gitlab/` mirrors `/var/opt/gitlab` (repositories, database, uploads, LFS, etc.)
- `etc-gitlab/` mirrors `/etc/gitlab` (configuration, secrets, SSL certs)
- `var-log-gitlab/` mirrors `/var/log/gitlab` (service logs)

### Set Up Automated Sync

Create a cron job that syncs GitLab's data to the backup volume:

```bash
sudo crontab -e
```

Add these entries:

```
# Sync GitLab data to backup volume every 6 hours
0 */6 * * * rsync -a --delete /var/opt/gitlab/ /mnt/gitlab-data/gitlab/
0 */6 * * * rsync -a --delete /etc/gitlab/ /mnt/gitlab-data/etc-gitlab/
0 */6 * * * rsync -a --delete /var/log/gitlab/ /mnt/gitlab-data/var-log-gitlab/
```

You can adjust the frequency based on your RPO (Recovery Point Objective). For critical instances, consider running the sync hourly or even using volume-level snapshots provided by your cloud provider.

### Verify the Backup

Run the sync manually and verify:

```bash
sudo rsync -a --delete /var/opt/gitlab/ /mnt/gitlab-data/gitlab/
sudo rsync -a --delete /etc/gitlab/ /mnt/gitlab-data/etc-gitlab/
sudo rsync -a --delete /var/log/gitlab/ /mnt/gitlab-data/var-log-gitlab/

# Check the structure
ls -la /mnt/gitlab-data/
ls -la /mnt/gitlab-data/gitlab/gitlab-rails/
cat /mnt/gitlab-data/gitlab/gitlab-rails/VERSION
```

## Step 7: Configure SSO (Optional)

If your organization uses a centralized identity provider, configuring SSO eliminates the need for separate GitLab passwords and gives you centralized access control.

### SAML with Microsoft Entra ID (Azure AD)

Add the following to `/etc/gitlab/gitlab.rb`:

```ruby
gitlab_rails['omniauth_enabled'] = true
gitlab_rails['omniauth_allow_single_sign_on'] = ['saml']
gitlab_rails['omniauth_block_auto_created_users'] = false
gitlab_rails['omniauth_auto_link_saml_user'] = true

gitlab_rails['omniauth_providers'] = [
  {
    name: "saml",
    label: "Microsoft Login",
    args: {
      assertion_consumer_service_url: "https://gitlab.example.com/users/auth/saml/callback",
      idp_cert_fingerprint: "<YOUR_IDP_CERT_FINGERPRINT>",
      idp_sso_target_url: "https://login.microsoftonline.com/<YOUR_TENANT_ID>/saml2",
      issuer: "https://gitlab.example.com",
      name_identifier_format: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
      attribute_statements: {
        first_name: ['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'],
        last_name: ['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname'],
        email: ['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress']
      }
    }
  }
]
```

On the Entra ID side, you'll need to:
1. Register a new Enterprise Application
2. Set the Reply URL to `https://gitlab.example.com/users/auth/saml/callback`
3. Configure the required claims (email, first name, last name)
4. Copy the IdP certificate fingerprint and SSO URL into the config above

### OAuth with Bitbucket (Optional)

If you also want to allow Bitbucket login:

```ruby
gitlab_rails['omniauth_providers'] << {
  name: "bitbucket",
  app_id: "<YOUR_BITBUCKET_APP_ID>",
  app_secret: "<YOUR_BITBUCKET_APP_SECRET>",
  url: "https://bitbucket.org/"
}
```

After adding SSO configuration, apply the changes:

```bash
sudo gitlab-ctl reconfigure
```

### Testing SSO

1. Open your GitLab URL in an incognito browser window
2. You should see a **"Microsoft Login"** button on the sign-in page
3. Click it and authenticate with your Microsoft account
4. On first login, GitLab auto-creates an account linked to your SSO identity

Common gotchas:
- **Reply URL mismatch:** the URL in Entra ID must exactly match `assertion_consumer_service_url` in gitlab.rb
- **Clock skew:** if the server's time is off by more than a few minutes, SAML validation will fail. Use NTP: `sudo timedatectl set-ntp true`
- **Certificate rotation:** when your IdP rotates its signing certificate, you'll need to update the fingerprint in gitlab.rb

## Step 8: Post-Install Verification

Before calling it done, run through these checks to make sure everything is working correctly.

### Check Service Status

```bash
sudo gitlab-ctl status
```

You should see all services running. A healthy GitLab instance typically has 15-17 services:

```
run: alertmanager: (pid 1234) 100s
run: gitaly: (pid 1235) 100s
run: gitlab-exporter: (pid 1236) 100s
run: gitlab-kas: (pid 1237) 100s
run: gitlab-workhorse: (pid 1238) 100s
run: logrotate: (pid 1239) 100s
run: nginx: (pid 1240) 100s
run: node-exporter: (pid 1241) 100s
run: postgres-exporter: (pid 1242) 100s
run: postgresql: (pid 1243) 100s
run: prometheus: (pid 1244) 100s
run: puma: (pid 1245) 100s
run: redis: (pid 1246) 100s
run: redis-exporter: (pid 1247) 100s
run: registry: (pid 1248) 100s
run: sidekiq: (pid 1249) 100s
```

If any service shows `down`, check its logs:

```bash
sudo gitlab-ctl tail <service-name>
```

### Run GitLab's Built-in Health Check

```bash
sudo gitlab-rake gitlab:check SANITIZE=true
```

This runs a comprehensive check of GitLab's configuration, database, Git repositories, and more. Every line should show `... yes` or informational output. Fix any items marked with a warning or error.

### Access the Web UI

Open `https://gitlab.example.com` in your browser. On the first visit after installation, you'll need to set the root password. The initial auto-generated password is available at:

```bash
sudo cat /etc/gitlab/initial_root_password
```

**Important:** This file is automatically deleted after 24 hours. Save the password or set a new one immediately through the web UI at **Admin Area > Users > root > Edit**.

### Test Email (If Configured)

```bash
sudo gitlab-rails console
```

In the Rails console:

```ruby
Notify.test_email('your-email@example.com', 'Test Subject', 'Test Body').deliver_now
```

Check your inbox for the test email.

## Troubleshooting

### `gitlab-ctl reconfigure` Fails

The most common causes:
- **Port conflicts:** another service is already using port 80 or 443. Check with `sudo lsof -i :80` and `sudo lsof -i :443`.
- **Insufficient memory:** GitLab needs at least 4 GB of free RAM for reconfigure. Check with `free -h`.
- **Disk full:** reconfigure writes temporary files. Verify with `df -h`.

### Certbot ACME Failures

If Certbot can't obtain a certificate:
- **Port 80 blocked:** verify `sudo ufw status` shows port 80 open
- **Behind Cloudflare proxy:** if Cloudflare is proxying traffic, the HTTP-01 challenge may fail. Either temporarily disable Cloudflare proxy (grey cloud the DNS record), or use the DNS-01 challenge instead:

```bash
sudo apt install -y python3-certbot-dns-cloudflare
# Create /etc/letsencrypt/cloudflare.ini with your API token
sudo certbot certonly --dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini -d gitlab.example.com
```

- **DNS not propagated:** verify with `dig gitlab.example.com` that it resolves to your server's IP

### Services Not Starting

Check the service-specific logs:

```bash
# General log directory
ls /var/log/gitlab/

# Specific service logs
sudo gitlab-ctl tail puma
sudo gitlab-ctl tail postgresql
sudo gitlab-ctl tail nginx
```

Common issues:
- **PostgreSQL won't start:** usually a data directory permission issue. Check `ls -la /var/opt/gitlab/postgresql/data/`
- **Redis won't start:** stale PID file. Remove it: `sudo rm -f /var/opt/gitlab/redis/redis.pid`

### 502 Bad Gateway

This almost always means Puma (the application server) hasn't finished starting yet. GitLab can take 2-5 minutes to fully boot, especially on servers with less RAM. Wait and refresh.

If it persists:
- Check Puma logs: `sudo gitlab-ctl tail puma`
- Verify RAM: `free -h`. If swap is being used heavily, you need more RAM
- Check if Puma workers are running: `ps aux | grep puma`

### Permission Errors

If you see permission denied errors in logs:

```bash
sudo gitlab-ctl reconfigure
```

Reconfigure resets all file permissions to their expected values. If that doesn't help:

```bash
sudo chown -R git:git /var/opt/gitlab/git-data
sudo chown -R git:git /var/opt/gitlab/gitlab-rails
sudo chmod 2770 /var/opt/gitlab/git-data/repositories
```

## Best Practices

- **Keep `gitlab.rb` in version control**, but exclude `gitlab-secrets.json`. The secrets file contains encryption keys for CI/CD variables, 2FA tokens, and runner authentication tokens. If you lose it, that encrypted data is gone forever.
- **Set up the backup volume from day one.** Don't wait until you have "enough data to worry about." By then it's too late.
- **Test your restore process.** A backup that's never been tested is just a hope. Spin up a test instance and restore from your backup volume at least quarterly.
- **Use GitLab's bundled Prometheus and Grafana.** They're pre-configured to monitor all GitLab services. Access Grafana at `https://gitlab.example.com/-/grafana`.
- **Plan your upgrade path.** GitLab requires sequential version upgrades. You can't jump from 16.x to 18.x directly. Check the [upgrade path tool](https://gitlab-com.gitlab.io/support/toolbox/upgrade-path/) before upgrading.
- **Keep the OS updated.** Regular `apt update && apt upgrade` for security patches. GitLab's packages won't be affected by OS updates.
- **Pin your GitLab version** to prevent accidental upgrades during `apt upgrade`. Hold the package:

```bash
sudo apt-mark hold gitlab-ee
```

When you're ready to upgrade intentionally:

```bash
sudo apt-mark unhold gitlab-ee
sudo apt install gitlab-ee=<NEW_VERSION>
sudo apt-mark hold gitlab-ee
```

## Key Takeaways

- Self-hosting GitLab gives you full control over your source code, authentication, and infrastructure, but it comes with operational responsibility.
- Use **Certbot** for SSL certificates. It's more flexible and easier to debug than GitLab's built-in Let's Encrypt.
- The **backup volume** is your lifeline. Set it up on day one, automate the sync, and test restores regularly.
- `gitlab-secrets.json` is the single most critical file in your GitLab installation. Lose it, and all encrypted data (CI/CD variables, 2FA keys, runner tokens) becomes unrecoverable.
- GitLab's `gitlab-ctl reconfigure` is your swiss army knife. It applies configuration changes, fixes permissions, and restarts services.
- Start with the basics (install, SSL, backups) and layer on complexity (SSO, monitoring, CI runners) incrementally.

In the next post, I cover [disaster recovery: restoring GitLab from a backup volume](/blogs/gitlab-disaster-recovery-restore-from-backup) when things go sideways. If you're setting up a production instance, I'd strongly recommend reading that one too, because a backup you've never tested is just a hope.

I've also open-sourced the restore and prerequisites check scripts on GitHub at [gitlab-scripts](https://github.com/DhruvChavda/gitlab-scripts). Feel free to use them, fork them, or adapt them to your setup.
