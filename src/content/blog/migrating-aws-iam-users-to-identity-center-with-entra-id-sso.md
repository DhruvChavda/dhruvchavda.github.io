---
title: "Migrating AWS IAM Users to Identity Center with Microsoft Entra ID SSO"
description: "A step-by-step guide to replacing IAM users with SSO using AWS Identity Center and Microsoft Entra ID, from audit to decommission."
pubDate: 2026-02-15
category: ["AWS", "Cloud", "DevOps"]
tags: ["aws", "sso", "devops", "cloud", "security"]
draft: false
---

## Why This Guide Exists

If you've ever managed an AWS environment with more than a handful of people, you know how quickly IAM users spiral out of control. Shared credentials in Slack DMs. Access keys that haven't been rotated since 2022. Former employees whose accounts are still active because nobody remembered to delete them.

I've been there. We had **dozens of IAM users** spread across multiple AWS accounts, each with their own console password and long-lived access keys. Some had `AdministratorAccess` attached directly. Some were in groups nobody could explain. And our "offboarding process" was a Confluence page that nobody followed.

When we finally decided to migrate to **AWS IAM Identity Center** with **Microsoft Entra ID** (formerly Azure AD) as our identity provider, it was one of the best infrastructure decisions we made. Single sign-on. Automatic provisioning and deprovisioning. No more access keys for humans. One place to manage who has access to what.

But the migration itself? It took planning. The official docs are spread across AWS and Microsoft, and they don't tell you about the gotchas. This guide is everything I wish I had when I started. Every command has been run. Every caveat has been hit.

## Architecture: Before and After

**Before:** Individual IAM users with long-lived access keys and console passwords, logging directly into AWS accounts.

**After:** Microsoft Entra ID (the identity provider) authenticates users via **SAML 2.0**, which feeds into **AWS IAM Identity Center**. Identity Center then grants access to AWS accounts through **Permission Sets**, which are essentially IAM roles created and managed automatically.

The integration uses two protocols:

- **SAML 2.0** for federated authentication (the actual SSO login flow)
- **SCIM 2.0** for automatic provisioning and deprovisioning of users and groups from Entra ID into Identity Center

The result: you manage users and groups in Entra ID, and AWS access follows automatically.

## Phase 1: Audit and Planning

Before touching any configuration, you need a **complete picture** of who has access to what, what depends on those credentials, and where everything is going.

### Step 1.1: Generate a Full IAM User Inventory

The **IAM Credential Report** is your single best source of truth. It exports every IAM user with their policies, groups, access keys, MFA devices, and last activity.

```bash
# Generate the report (takes a few seconds)
aws iam generate-credential-report

# Wait 5-10 seconds, then download it
aws iam get-credential-report \
  --query 'Content' \
  --output text | base64 --decode > iam-credential-report.csv
```

Open `iam-credential-report.csv` in a spreadsheet. Key columns to focus on:

- **user** — the username
- **password_enabled** — whether console login is active
- **password_last_used** — when they last logged into the console
- **access_key_1_active** / **access_key_2_active** — whether access keys exist
- **access_key_1_last_used_date** — when the key was last used
- **mfa_active** — whether MFA is enabled

For a deeper per-user audit, run this script to capture policies and group memberships:

```bash
#!/bin/bash
# save as audit-iam-users.sh and run: bash audit-iam-users.sh > iam-audit.txt

echo "=== IAM USER AUDIT ==="
echo "Generated: $(date)"
echo ""

for user in $(aws iam list-users --query 'Users[*].UserName' --output text); do
  echo "============================================"
  echo "USER: $user"
  echo "============================================"

  echo "--- Console Access ---"
  aws iam get-login-profile --user-name "$user" 2>/dev/null \
    && echo "Console access: ENABLED" \
    || echo "Console access: DISABLED"

  echo ""
  echo "--- Access Keys ---"
  aws iam list-access-keys --user-name "$user" \
    --query 'AccessKeyMetadata[*].[AccessKeyId,Status,CreateDate]' \
    --output table

  echo ""
  echo "--- Attached Managed Policies ---"
  aws iam list-attached-user-policies --user-name "$user" \
    --query 'AttachedPolicies[*].[PolicyName,PolicyArn]' --output table

  echo ""
  echo "--- Inline Policies ---"
  for policy in $(aws iam list-user-policies --user-name "$user" \
    --query 'PolicyNames[*]' --output text); do
    echo "Policy: $policy"
    aws iam get-user-policy --user-name "$user" --policy-name "$policy" \
      --query 'PolicyDocument' --output json
  done

  echo ""
  echo "--- Groups ---"
  aws iam list-groups-for-user --user-name "$user" \
    --query 'Groups[*].GroupName' --output text

  echo ""
  echo "--- MFA Devices ---"
  aws iam list-mfa-devices --user-name "$user" \
    --query 'MFADevices[*].SerialNumber' --output text

  echo ""
done
```

For **multi-account** environments, repeat this audit in every account, or use **AWS IAM Access Analyzer** with unused access analysis to find stale permissions across the org.

### Step 1.2: Identify and Classify Each User

Go through your credential report and classify every IAM user into one of three categories:

| Category | Definition | Migration Action |
|----------|-----------|-----------------|
| **Human user (console)** | Has `password_enabled = true`, logs into the AWS console | Migrate to SSO via Identity Center |
| **Human user (programmatic)** | Has active access keys, used by a person for CLI/SDK work | Migrate to SSO + `aws sso login` for CLI access |
| **Service account** | Has active access keys, used by an application, CI/CD pipeline, or automation | Do NOT migrate to SSO. Convert to IAM Role or keep with key rotation |

Create a spreadsheet with columns: `Username | Category | Policies | Equivalent Permission Set | Target Entra Group | Target AWS Account(s) | Notes`

### Step 1.3: Map IAM Policies to Permission Sets

For each human user, determine what **Permission Set** in Identity Center will replace their current access.

Common mappings:

- `AdministratorAccess` → Permission Set: **AdministratorAccess** (AWS managed)
- `PowerUserAccess` → Permission Set: **PowerUserAccess** (AWS managed)
- `ReadOnlyAccess` → Permission Set: **ReadOnlyAccess** (AWS managed)
- `ViewOnlyAccess` → Permission Set: **ViewOnlyAccess** (AWS managed)
- Custom inline policies → Permission Set: **Custom** (you'll create one with the same policy JSON)

If a user has multiple policies (e.g., `AmazonS3FullAccess` + `AmazonEC2FullAccess`), you can either combine them into one custom permission set or assign multiple permission sets to the same group/account mapping.

**Limits to know:** A permission set supports up to **10 AWS managed policies** and **1 inline policy** (up to 10,240 characters). If you need more, split into multiple permission sets.

### Step 1.4: Design Your Entra ID Group Structure

Plan which Entra ID security groups will map to which Permission Sets and AWS accounts. Use a naming convention that encodes the account and role:

```
AWS-<AccountAlias>-<RoleName>
```

Examples:

- `AWS-Production-Admin` → AdministratorAccess on the Production account
- `AWS-Production-ReadOnly` → ReadOnlyAccess on the Production account
- `AWS-Dev-PowerUser` → PowerUserAccess on the Dev account
- `AWS-AllAccounts-Billing` → Billing on all accounts

Write this mapping down. You'll create these groups in Entra ID during Phase 4 and assign them in Phase 5.

### Step 1.5: Plan for Service Accounts and Access Keys

For each service account identified in Step 1.2:

1. **If it runs on AWS (EC2, Lambda, ECS, etc.):** Replace the access key with an **IAM Role** attached to the compute resource. This is the most secure option.

2. **If it runs outside AWS:**
   - **GitHub Actions:** Use OIDC federation with `aws-actions/configure-aws-credentials`. No long-lived keys needed.
   - **Other CI/CD (Jenkins, GitLab, etc.):** Use **IAM Roles Anywhere** with X.509 certificates.
   - **Legacy apps that truly cannot use roles:** Keep as IAM user, but enable key rotation and scope the policy tightly.

3. Document the decision for each service account in your spreadsheet.

### Step 1.6: Establish a Communication Plan and Timeline

Draft communications covering:

- **What's changing:** "We're moving from individual AWS logins to SSO via your Microsoft account."
- **Why:** "Simpler login (no separate AWS password), better security, automatic access provisioning."
- **When:** Give specific dates for pilot, full rollout, and legacy access decommission.
- **What users need to do:** Log in via the new AWS access portal URL, reconfigure AWS CLI profiles.
- **Who to contact for help:** Designate a point of contact.

Recommended timeline:

- **Week 1 to 2:** Phases 2 through 4 (infrastructure setup, no user impact)
- **Week 3:** Phase 5 (permission set creation) + Phase 6 pilot with 3 to 5 users
- **Week 4:** Full rollout to all users (parallel access: old IAM login + new SSO both work)
- **Week 5 to 6:** Monitor and troubleshoot
- **Week 7 to 8:** Phase 7 (decommission legacy IAM users)

## Phase 2: Enable IAM Identity Center

### Step 2.1: Verify AWS Organizations Is Enabled

Identity Center requires **AWS Organizations**. If you're running a single standalone account, you need to create an organization first.

1. Sign in to the **AWS Management Console** as the root user or an IAM user with admin access in your management (payer) account.
2. Go to **AWS Organizations** (search in the console search bar).
3. If you see "AWS Organizations is not set up," click **Create an organization**.
   - Choose **All features** (not just consolidated billing).
   - If you have other AWS accounts, invite them to the organization.
4. If Organizations is already active, verify your member accounts are listed.

### Step 2.2: Choose Your IAM Identity Center Home Region

Identity Center is configured in a **single Region**. This is where all your SSO configuration, user directory, and permission sets live. Choose carefully because **changing it later requires disabling and re-enabling the service**.

In the AWS Console, use the **Region selector** (top-right corner) to switch to your preferred Region. Common choices: `us-east-1`, `eu-west-1`, `ap-south-1`. Pick a Region close to your users or aligned with your compliance requirements.

### Step 2.3: Enable IAM Identity Center

1. In the AWS Console, search for **"IAM Identity Center"** and open it.
2. Click the **Enable** button (or "Enable with AWS Organizations").
3. Wait a few seconds. The Identity Center dashboard will load.
4. You should now see:
   - A **Dashboard** with your AWS access portal URL (e.g., `https://d-xxxxxxxxxx.awsapps.com/start`)
   - **Settings** page with identity source (currently set to "Identity Center directory")
   - Navigation for Users, Groups, Permission sets, AWS accounts

### Step 2.4: Delegate Administration to a Member Account (Recommended)

AWS strongly recommends **NOT** running Identity Center from the management account. Delegate to a dedicated "Identity" or "Security" member account.

1. In the management account, go to **IAM Identity Center → Settings**.
2. Scroll to the **Management** section.
3. Find **Delegated administrator** and click **Register account**.
4. Select the member account you want to delegate to (e.g., your Security or Identity account).
5. Click **Register**.
6. From this point forward, **sign in to the delegated admin account** for all Identity Center configuration.

> If you only have one AWS account, skip this step. You'll configure everything in that single account. Consider creating a second account later for better security.

### Step 2.5: Note the Identity Center Metadata (for Phase 3)

Download the AWS Service Provider metadata that you'll upload to Entra ID.

1. In the delegated admin account (or management account), go to **IAM Identity Center → Settings**.
2. Click the **Identity source** tab.
3. Click **Actions → Change identity source**.
4. Select **External identity provider**. **Do NOT click "Next" yet.** You're here only to access the metadata.
5. In the **Service provider metadata** section, you'll see:
   - **IAM Identity Center Assertion Consumer Service (ACS) URL** — copy this.
   - **IAM Identity Center issuer URL** — copy this.
   - **Download metadata file** button — click to download the XML file.
6. Save these three items. You'll need them in Phase 3.
7. **Click Cancel** (or leave this page open in a separate tab because you'll come back to complete the identity source change in Phase 3.3).

## Phase 3: Configure Microsoft Entra ID as External IdP (SAML)

This is where you establish the SAML trust between Entra ID and AWS IAM Identity Center so users can authenticate via their Microsoft credentials.

### Step 3.1: Add the AWS IAM Identity Center Enterprise App in Entra ID

1. Open a browser and go to **https://entra.microsoft.com**.
2. Sign in with an account that has the **Cloud Application Administrator** or **Application Administrator** role.
3. In the left navigation, go to **Identity → Applications → Enterprise applications**.
4. Click **+ New application** at the top.
5. In the **Browse Microsoft Entra Gallery** search box, type **"AWS IAM Identity Center"**.
6. Select **AWS IAM Identity Center (successor to AWS Single Sign-On)** from the results.
7. On the right panel, give it a display name (default is fine, or use something like "AWS SSO").
8. Click **Create**.
9. Wait 10 to 20 seconds. You'll be taken to the app's overview page.

### Step 3.2: Configure SAML Single Sign-On in Entra ID

1. In the Enterprise App you just created, click **Single sign-on** in the left menu.
2. Click **SAML** as the SSO method.
3. You'll see the **"Set up Single Sign-On with SAML"** page with 5 sections.

**Section 1: Basic SAML Configuration**

4. Click the **Edit** (pencil) icon.
5. Click **Upload metadata file** (at the top of the panel).
6. Select the **AWS Service Provider metadata XML file** you downloaded in Phase 2.5.
7. This auto-populates:
   - **Identifier (Entity ID):** Something like `https://us-east-1.signin.aws.amazon.com/platform/saml/d-xxxxxxxxxx`
   - **Reply URL (ACS URL):** Something like `https://us-east-1.signin.aws.amazon.com/platform/saml/acs/d-xxxxxxxxxx`
8. Optionally fill in the **Sign-on URL** with your portal's SAML assertion URL.
9. Click **Save** and close the panel.

**Section 2: Attributes and Claims**

10. Click the **Edit** (pencil) icon.
11. Verify the following claims are present. If not, click **+ Add new claim** to create them:

| Claim name | Value (Source attribute) |
|------------|------------------------|
| `Unique User Identifier (Name ID)` | `user.userprincipalname` (format: `emailAddress`) |
| `emailaddress` | `user.mail` |
| `givenname` | `user.givenname` |
| `surname` | `user.surname` |
| `name` | `user.userprincipalname` |

12. For the **Name ID** claim:
    - Click on it.
    - Set **Name identifier format** to **Email address**.
    - Set **Source** to **Attribute**.
    - Set **Source attribute** to `user.userprincipalname`.
    - Click **Save**.

**Section 3: SAML Signing Certificate**

13. In the **SAML Signing Certificate** section, find **Federation Metadata XML**.
14. Click **Download** next to it.
15. Save this file. You'll upload it to AWS in the next step.

> **Important:** Note the certificate **expiration date**. Set a calendar reminder to renew it before it expires (typically 3 years out). An expired certificate **breaks SSO entirely**.

### Step 3.3: Change Identity Source in AWS IAM Identity Center

1. Go back to the **AWS Console** in your delegated admin account.
2. Navigate to **IAM Identity Center → Settings → Identity source**.
3. Click **Actions → Change identity source**.
4. Select **External identity provider**.
5. Click **Next**.
6. On the **Configure external identity provider** page:
   - In the **Identity provider metadata** section, under **IdP SAML metadata**, click **Choose file**.
   - Select the **Federation Metadata XML** file you downloaded from Entra ID in Step 3.2.
   - Click **Open**.
7. Click **Next**.
8. **Read the warning carefully.** It states that changing the identity source will delete all users and groups in the Identity Center directory.
9. In the confirmation field, type **ACCEPT** (all caps).
10. Click **Change identity source**.
11. Wait for confirmation. The identity source should now show as **External identity provider**.

> **Critical:** If you had users/groups in the built-in Identity Center directory, they are now deleted. This is expected. SCIM provisioning (Phase 4) will recreate them from Entra ID.

### Step 3.4: Assign a Test User and Create Them in Identity Center

Before testing SSO, at least one user must be assigned to the Entra ID Enterprise App. **But here's an important caveat:** SCIM provisioning isn't enabled yet (that's Phase 4), so assigning a user in Entra ID does **not** automatically create them in AWS Identity Center. You need to **manually create a matching user in Identity Center** for the SSO test to work.

**In Entra ID:**

1. Go to **Entra admin center → Enterprise applications → AWS IAM Identity Center**.
2. Click **Users and groups** in the left menu.
3. Click **+ Add user/group**.
4. Under **Users**, click **None Selected**.
5. Search for your test user (e.g., your own account).
6. Select the user and click **Select**.
7. Under **Role**, leave as **Default Access**.
8. Click **Assign**.

**In AWS Identity Center (manual user creation):**

9. Go to **IAM Identity Center → Users**.
10. Click **Add user**.
11. Fill in the user details. **The username (email) must exactly match the user's `userPrincipalName` in Entra ID.** This is what SAML uses to match the assertion to the Identity Center user.
12. Fill in first name, last name, and display name.
13. Click **Next**, optionally add them to a group, then click **Add user**.

This manual step is only needed for testing before SCIM is set up. Once SCIM is running (Phase 4), users are created automatically.

> **With Entra ID P1:** You can assign a security group instead of individual users. This is much easier to manage. Without P1, you must add users one by one.

### Step 3.5: Test the SAML Connection

**Method A: Test from Entra ID**

1. In the Enterprise App, go to **Single sign-on**.
2. Scroll to section 5: **Test single sign-on**.
3. Click **Test**.
4. Click **Sign in as current user** (or sign in as your test user).
5. You'll be redirected to the AWS SSO portal. If the SAML assertion is valid, you'll see the AWS access portal (it may show "You do not have any applications" because no permission sets are assigned yet, and that's fine — it means SAML works).

**Method B: Test from AWS**

1. Open your **AWS access portal URL** (e.g., `https://d-xxxxxxxxxx.awsapps.com/start`).
2. You should be redirected to the Microsoft login page.
3. Sign in with your Entra ID credentials.
4. If successful, you'll land on the AWS access portal.

**If you get errors, check:**

- The ACS URL matches between Entra ID and AWS.
- The Name ID format is set to Email address.
- The Federation Metadata XML was uploaded correctly on both sides.
- The user exists in **both** Entra ID (assigned to the app) **and** AWS Identity Center (manually created) with matching email/UPN.

## Phase 4: Configure SCIM Auto-Provisioning

With SAML working, now set up automatic synchronization of users and groups from Entra ID into Identity Center. This eliminates the manual user creation you did in Phase 3.

> **Prerequisite:** SCIM provisioning requires **Entra ID P1 or P2** license. If you only have the Free tier, you'll need to manually create users in Identity Center or upgrade.

### Step 4.1: Enable Automatic Provisioning in AWS

1. Sign in to the **delegated admin account** (not root — root cannot enable SCIM).
2. Go to **IAM Identity Center → Settings**.
3. In the **Automatic provisioning** section, click **Enable**.
4. A dialog appears with two critical values:
   - **SCIM endpoint:** A URL like `https://scim.us-east-1.amazonaws.com/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx/scim/v2`
   - **Access token:** A long string (shown only once).
5. **Copy both values immediately** and store them securely (e.g., in a password manager).
6. Click **Close**.

> **The access token is shown only once.** If you lose it, you must generate a new one (which invalidates the old one). The token has an expiry (typically 1 year) so set a reminder to rotate it.

### Step 4.2: Configure SCIM Provisioning in Entra ID

1. In the **Entra admin center**, go to **Enterprise applications → AWS IAM Identity Center**.
2. Click **Provisioning** in the left menu.
3. Click **Get started**.
4. Set **Provisioning Mode** to **Automatic**.
5. Under **Admin Credentials**:
   - **Tenant URL:** Paste the **SCIM endpoint** from Step 4.1.
   - **Secret Token:** Paste the **Access token** from Step 4.1.
6. Click **Test Connection**.
7. Wait a few seconds. You should see: **"The supplied credentials are authorized to enable provisioning."**
   - If it fails: double-check the SCIM endpoint URL (no trailing spaces), verify the token, and ensure the delegated admin account has the necessary `sso:*` permissions.
8. Click **Save**.

### Step 4.3: Configure Attribute Mappings

1. Still in the **Provisioning** section, expand **Mappings**.
2. Click **Provision Microsoft Entra ID Users**.
3. Review the attribute mappings table. Ensure these mappings exist:

| Entra ID Attribute | Target Attribute (SCIM) | Mapping Type |
|--------------------|------------------------|--------------|
| `userPrincipalName` | `userName` | Direct |
| `Switch([IsSoftDeleted], , "False", "True", "True", "False")` | `active` | Expression |
| `displayName` | `displayName` | Direct |
| `mail` | `emails[type eq "work"].value` | Direct |
| `givenName` | `name.givenName` | Direct |
| `surname` | `name.familyName` | Direct |

4. If any mapping is missing, click **Add New Mapping** and configure it.
5. Click **Save**.

6. Go back and click **Provision Microsoft Entra ID Groups**.
7. Ensure these mappings exist:

| Entra ID Attribute | Target Attribute (SCIM) | Mapping Type |
|--------------------|------------------------|--------------|
| `displayName` | `displayName` | Direct |
| `objectId` | `externalId` | Direct |
| `members` | `members` | Direct |

8. Click **Save**.

### Step 4.4: Create Security Groups in Entra ID

1. In the Entra admin center, go to **Identity → Groups → All groups**.
2. Click **+ New group**.
3. Configure:
   - **Group type:** Security
   - **Group name:** e.g., `AWS-Production-Admin`
   - **Group description:** e.g., "AdministratorAccess to Production AWS account"
   - **Membership type:** Assigned (or Dynamic if you have rules)
4. Under **Members**, click **No members selected**.
5. Search and select the users who should be in this group.
6. Click **Select**, then **Create**.
7. Repeat for each group in your plan (e.g., `AWS-Dev-PowerUser`, `AWS-AllAccounts-ReadOnly`, etc.).

### Step 4.5: Assign Groups to the Enterprise App

Only users and groups assigned to the Enterprise App will be provisioned to AWS.

1. Go to **Enterprise applications → AWS IAM Identity Center → Users and groups**.
2. Click **+ Add user/group**.
3. Under **Users and groups**, click **None Selected**.
4. Switch to the **Groups** tab.
5. Select a group (e.g., `AWS-Production-Admin`).
6. Click **Select**, then **Assign**.
7. Repeat for every group that should have AWS access.

### Step 4.6: Start Provisioning and Verify

1. In the Enterprise App, go to **Provisioning → Overview**.
2. Click **Start provisioning**.
3. The initial sync begins. Depending on the number of users:
   - Under 100 users: typically completes in 5 to 20 minutes.
   - Larger directories: up to 40 minutes.
4. Check progress: go to **Provisioning → Provisioning logs** to see each sync action (Create, Update, Skip, Error).
5. Common log entries:
   - **Success: Create** — User or group was created in AWS.
   - **Skipped: Not effectively entitled** — User is not assigned to the Enterprise App.
   - **Error** — Something went wrong. Click for details.

6. **Verify in AWS:**
   - Go to **IAM Identity Center → Users**. Your Entra ID users should now appear.
   - Go to **IAM Identity Center → Groups**. Your Entra ID groups should appear with their members.

> **Tip: Provision on Demand.** For testing, you can provision a single user instantly without waiting for the full sync cycle. Go to **Provisioning → Provision on demand**, search for a user, and click **Provision**.

### Step 4.7: Monitor Ongoing Provisioning

After the initial sync, Entra ID runs incremental syncs every ~40 minutes automatically.

1. To check the status, go to **Provisioning → Overview**. You'll see last sync time, number of users/groups synced, and current cycle status.

2. To get alerts on failures:
   - Go to **Provisioning → Settings**.
   - Under **Notification Email**, add your admin email address.
   - Check **Send an email notification when a failure occurs**.
   - Click **Save**.

3. When you **add a new user** to a group in Entra ID, they'll be automatically provisioned to AWS within ~40 minutes. Use "Provision on demand" if you need it faster.

4. When you **remove a user** from all groups (or disable them in Entra ID), the next sync cycle will deactivate (soft-delete) them in AWS Identity Center. They immediately lose SSO access.

## Phase 5: Create Permission Sets and Map to Accounts

Now define what level of access each group gets, and on which AWS accounts.

### Step 5.1: Create Permission Sets

Permission sets define the IAM policies that get applied when a user assumes a role via SSO.

1. In the delegated admin account, go to **IAM Identity Center → Permission sets**.
2. Click **Create permission set**.

**For a predefined (AWS managed) permission set:**

3. Select **Predefined permission set**.
4. Choose a policy, e.g., **AdministratorAccess**.
5. Click **Next**.
6. Give it a name (defaults to the policy name).
7. Set **Session duration** (how long the temporary credentials last):
   - For admin roles: **1 hour** (security best practice).
   - For developer roles: **4 to 8 hours** (practical for daily work).
   - For read-only roles: **8 to 12 hours**.
   - Maximum allowed: 12 hours.
8. Click **Next**, review, and click **Create**.

**For a custom permission set:**

3. Select **Custom permission set**.
4. Click **Next**.
5. Choose how to define policies:
   - **AWS managed policies:** Attach up to 10 managed policies (e.g., `AmazonS3FullAccess`, `AmazonEC2ReadOnlyAccess`).
   - **Customer managed policies:** Reference policies that already exist in the target account(s) by name.
   - **Inline policy:** Paste a JSON policy document directly. Example:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket",
        "s3:PutObject"
      ],
      "Resource": [
        "arn:aws:s3:::my-app-bucket",
        "arn:aws:s3:::my-app-bucket/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "ec2:Describe*",
        "ec2:StartInstances",
        "ec2:StopInstances"
      ],
      "Resource": "*"
    }
  ]
}
```

   - **Permissions boundary:** Optionally attach a permissions boundary policy to limit the maximum permissions.
6. Click **Next**.
7. Name it (e.g., "DevS3AndEC2Access"), set session duration.
8. Click **Create**.

Repeat for each role type you identified in Phase 1.3.

### Step 5.2: Assign Groups + Permission Sets to AWS Accounts

This is where you connect the dots: Group X gets Permission Set Y on Account Z.

1. Go to **IAM Identity Center → AWS accounts**.
2. You'll see your Organization structure with all accounts listed.
3. Select the checkbox next to the target account (e.g., "Production").
4. Click **Assign users or groups**.
5. On the **Groups** tab, find and select the group (e.g., `AWS-Production-Admin`).
6. Click **Next**.
7. Select the permission set(s) to assign (e.g., `AdministratorAccess`).
8. Click **Next**.
9. Review the assignment:
   - Group: `AWS-Production-Admin`
   - Account: `Production (123456789012)`
   - Permission set: `AdministratorAccess`
10. Click **Submit**.

Repeat for each group/account/permission combination:

- `AWS-Dev-PowerUser` → Dev account → PowerUserAccess
- `AWS-AllAccounts-ReadOnly` → All accounts → ReadOnlyAccess
- etc.

> **What happens behind the scenes:** AWS creates an IAM Role in the target account (e.g., `AWSReservedSSO_AdministratorAccess_xxxxxxxxxxxx`) with a trust policy allowing Identity Center to assume it. **Do NOT modify these roles directly.**

### Step 5.3: Verify the Assignment

1. Go to **IAM Identity Center → AWS accounts**.
2. Click on an account name.
3. You should see the assigned groups and their permission sets listed.
4. To verify the IAM role was created, switch to the target account and go to **IAM → Roles**. Search for `AWSReservedSSO_`. You should see roles matching your permission sets.

## Phase 6: Migrate Users and Validate

### Step 6.1: Pilot with a Small Group

Select 3 to 5 users from different teams and roles to test the full SSO flow.

Ensure the pilot users:

- Exist in Entra ID
- Are members of the correct Entra ID security groups
- Have been provisioned to AWS via SCIM (check Identity Center → Users)
- Their groups are assigned to the correct accounts and permission sets

Send them the **AWS access portal URL**: `https://d-xxxxxxxxxx.awsapps.com/start`

**Testing Console Access:**

1. Open the access portal URL in a browser.
2. Sign in with Microsoft credentials (you'll see the Microsoft login page).
3. Complete MFA if prompted (this is Microsoft's MFA, not AWS MFA).
4. After login, you should see a list of AWS accounts and roles.
5. Click on an account, then click **Management Console** next to a role.
6. You should land in the AWS Console with the correct permissions.

**Testing CLI Access (AWS CLI v2):**

Install or update to AWS CLI v2 (v1 doesn't support SSO natively), then configure:

```bash
# One-time setup
aws configure sso
```

When prompted, enter:

- **SSO session name:** `my-sso` (any name)
- **SSO start URL:** `https://d-xxxxxxxxxx.awsapps.com/start`
- **SSO Region:** `us-east-1` (your Identity Center Region)
- **SSO registration scopes:** `sso:account:access`

A browser window opens. Sign in with Microsoft credentials and approve. Back in the terminal, choose the account and role, then enter a CLI profile name (e.g., `prod-admin`).

To use the profile:

```bash
aws s3 ls --profile prod-admin
```

To log in again after session expires:

```bash
aws sso login --profile prod-admin
```

**Testing Programmatic/SDK Access:**

The SSO session credentials are cached locally and used automatically by SDKs when the profile is referenced.

For Terraform:

```hcl
provider "aws" {
  profile = "prod-admin"
  region  = "us-east-1"
}
```

Or use environment variables:

```bash
eval $(aws configure export-credentials --profile prod-admin --format env)
```

**Common pilot issues:**

- "I don't see any accounts" → Group assignment or permission set mapping is missing.
- "Access denied when I try to do X" → Permission set doesn't include the required policy.
- "MFA keeps prompting" → Controlled by Entra ID Conditional Access, not AWS.
- "Session expired too quickly" → Increase the permission set session duration.

### Step 6.2: Roll Out to All Users

Once the pilot is validated, migrate all remaining human users.

1. Add remaining users to their respective Entra ID groups (if not already done).
2. Wait for SCIM sync (~40 minutes) or use "Provision on demand" for urgency.
3. Verify in Identity Center → Users that all users appear.
4. Send the rollout communication to all users with the access portal URL, CLI setup instructions, FAQ, and support contact.

During the **parallel-run period** (recommended 2 to 4 weeks), both IAM user login and SSO login work simultaneously. Encourage users to switch to SSO immediately.

Monitor CloudTrail to track which authentication method is being used:

```bash
# Find console logins via SSO (look for "AssumeRoleWithSAML")
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithSAML \
  --start-time "2026-02-01" \
  --query 'Events[*].[EventTime,Username,CloudTrailEvent]' \
  --output table

# Find console logins via IAM user (look for "ConsoleLogin")
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=ConsoleLogin \
  --start-time "2026-02-01" \
  --query 'Events[*].[EventTime,Username]' \
  --output table
```

Track migration progress: create a checklist of all IAM users and mark each as "migrated to SSO" once they've confirmed they can log in.

## Phase 7: Decommission Legacy IAM Users

This is the security payoff. Remove old IAM credentials once all users are confirmed on SSO.

### Step 7.1: Final Verification

Check the IAM credential report one more time:

```bash
aws iam generate-credential-report
sleep 10
aws iam get-credential-report \
  --query 'Content' \
  --output text | base64 --decode > final-credential-report.csv
```

For each human user being decommissioned, verify:

- `password_last_used` is before the SSO migration date (they haven't used the IAM password since).
- `access_key_1_last_used_date` shows no recent usage (or keys are already inactive).

Use **IAM Access Analyzer (unused access)** for a more thorough check: go to **IAM → Access Analyzer → Analyzers**, create an analyzer of type **Unused access**, and review findings.

### Step 7.2: Disable Console Passwords

For each user:

```bash
aws iam delete-login-profile --user-name alice
```

Verify:

```bash
aws iam get-login-profile --user-name alice
# Expected: "NoSuchEntity" error = password is removed
```

### Step 7.3: Deactivate Access Keys (Soft Delete)

Set keys to **Inactive** first. This lets you reactivate quickly if something breaks.

```bash
# List keys for the user
aws iam list-access-keys --user-name alice

# Deactivate each key
aws iam update-access-key \
  --user-name alice \
  --access-key-id AKIAIOSFODNN7EXAMPLE \
  --status Inactive
```

Now **wait 2 to 4 weeks**. During this period:

- Monitor CloudTrail for `ErrorCode: InvalidClientTokenId` events, which indicate something is still trying to use the old key.
- If you find a dependency you missed, either fix it (migrate to a role) or reactivate the key temporarily.

### Step 7.4: Delete Access Keys

Permanently delete the keys once the waiting period passes with no issues:

```bash
aws iam delete-access-key \
  --user-name alice \
  --access-key-id AKIAIOSFODNN7EXAMPLE
```

### Step 7.5: Clean Up and Delete IAM Users

All attached resources must be removed before the user can be deleted. Here's the full cleanup sequence:

```bash
USER="alice"

# 1. Detach all managed policies
for arn in $(aws iam list-attached-user-policies --user-name $USER \
  --query 'AttachedPolicies[*].PolicyArn' --output text); do
  aws iam detach-user-policy --user-name $USER --policy-arn $arn
  echo "Detached policy: $arn"
done

# 2. Delete all inline policies
for policy in $(aws iam list-user-policies --user-name $USER \
  --query 'PolicyNames[*]' --output text); do
  aws iam delete-user-policy --user-name $USER --policy-name $policy
  echo "Deleted inline policy: $policy"
done

# 3. Remove from all groups
for group in $(aws iam list-groups-for-user --user-name $USER \
  --query 'Groups[*].GroupName' --output text); do
  aws iam remove-user-from-group --user-name $USER --group-name $group
  echo "Removed from group: $group"
done

# 4. Delete MFA devices
for mfa in $(aws iam list-mfa-devices --user-name $USER \
  --query 'MFADevices[*].SerialNumber' --output text); do
  aws iam deactivate-mfa-device --user-name $USER --serial-number $mfa
  aws iam delete-virtual-mfa-device --serial-number $mfa 2>/dev/null
  echo "Deleted MFA: $mfa"
done

# 5. Delete SSH public keys (if any)
for keyid in $(aws iam list-ssh-public-keys --user-name $USER \
  --query 'SSHPublicKeys[*].SSHPublicKeyId' --output text); do
  aws iam delete-ssh-public-key --user-name $USER --ssh-public-key-id $keyid
done

# 6. Delete signing certificates (if any)
for certid in $(aws iam list-signing-certificates --user-name $USER \
  --query 'Certificates[*].CertificateId' --output text); do
  aws iam delete-signing-certificate --user-name $USER --certificate-id $certid
done

# 7. Delete service-specific credentials (if any)
for credid in $(aws iam list-service-specific-credentials --user-name $USER \
  --query 'ServiceSpecificCredentials[*].ServiceSpecificCredentialId' \
  --output text); do
  aws iam delete-service-specific-credential --user-name $USER \
    --service-specific-credential-id $credid
done

# 8. Delete the user
aws iam delete-user --user-name $USER
echo "Deleted user: $USER"
```

### Step 7.6: Create a Break-Glass IAM User

Keep exactly **ONE** IAM user as an emergency backdoor in case SSO or Entra ID goes down.

1. In the **management account**:

```bash
aws iam create-user --user-name break-glass-admin

aws iam attach-user-policy \
  --user-name break-glass-admin \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

aws iam create-login-profile \
  --user-name break-glass-admin \
  --password '<VERY_STRONG_PASSWORD>' \
  --password-reset-required
```

2. Enable MFA immediately: log in as this user once to set up a **hardware MFA device** (YubiKey preferred) or virtual MFA.

3. Store the credentials securely:
   - Print the username, password, and MFA seed on paper.
   - Store in a **physical safe** or vault with restricted access.
   - **Do NOT** store in any digital password manager accessible via SSO (circular dependency).

4. Test the break-glass login quarterly to ensure it still works.

5. Monitor usage: set up a CloudWatch alarm on CloudTrail for any API call by this user, so you're alerted if it's ever used.

### Step 7.7: (Optional) Enforce SSO-Only Access via SCP

Prevent anyone from creating new IAM users with console access, enforcing SSO as the only login method.

1. Go to **AWS Organizations → Policies → Service control policies**.
2. Create a new SCP:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyIAMUserCreation",
      "Effect": "Deny",
      "Action": [
        "iam:CreateUser",
        "iam:CreateLoginProfile",
        "iam:CreateAccessKey"
      ],
      "Resource": "*",
      "Condition": {
        "StringNotLike": {
          "aws:PrincipalArn": [
            "arn:aws:iam::*:role/aws-reserved/sso.amazonaws.com/*",
            "arn:aws:iam::*:user/break-glass-admin"
          ]
        }
      }
    }
  ]
}
```

3. Attach this SCP to the **root OU** (or specific OUs) to enforce it across all accounts.

## Cost Summary

| Component | Cost |
|-----------|------|
| AWS IAM Identity Center | **$0** (free) |
| AWS Organizations | **$0** (free) |
| Microsoft Entra ID Free (SAML SSO only, no SCIM) | **$0/user/month** |
| Microsoft Entra ID P1 (SAML SSO + SCIM + Conditional Access) | **~$6/user/month** |
| Microsoft Entra ID P2 (adds PIM, access reviews) | **~$9/user/month** |
| M365 E3/E5/Business Premium (includes Entra P1 or P2) | **Check existing licenses** |

**Migration effort:** roughly 40 to 80 hours of admin time for a 50 to 200 user environment.

## Troubleshooting Quick Reference

| Challenge | Impact | Mitigation |
|-----------|--------|------------|
| Access key dependencies break | CI/CD pipelines and apps fail | Audit all keys via CloudTrail before decommissioning; convert to IAM Roles |
| Identity source switch deletes directory users | Existing Identity Center users and assignments are lost | Switch identity source before creating production assignments, or document everything for re-creation |
| SCIM sync delay (~40 min) | New users can't log in immediately | Use "Provision on demand" in Entra ID for urgent cases |
| Nested Entra ID groups not supported | Members of nested groups don't get provisioned | Use flat group structures or dynamic groups |
| SCIM token expires | Provisioning silently stops | Set calendar reminders; monitor provisioning health |
| UPN/email mismatch | Users can't log in or get duplicate accounts | Standardize UPNs before migration |
| Complex IAM policies don't fit Permission Sets | Permission gaps or over-permissioning | Split into multiple permission sets; use inline policies for custom needs |
| Entra ID or Microsoft outage | No one can SSO into AWS | Maintain a break-glass IAM user with MFA in a physical safe |
| SAML certificate expiration | SSO breaks entirely | Set calendar reminder for Entra ID SAML cert renewal (typically 3-year expiry) |
| Session duration too short | Users frustrated by frequent re-auth | Tune per permission set (1h for admin, 8h+ for dev/read-only) |
| Manual user needed for pre-SCIM SSO test | SSO test fails with "user not found" | Manually create a matching user in Identity Center before testing (Phase 3.4) |

## Key Takeaways

This migration took us about **three weeks** from planning to full rollout, with another two weeks of parallel-run before we started decommissioning IAM users. Here's what I'd tell anyone about to start:

1. **The audit is the hardest part.** Discovering all the access keys and service accounts hiding in your environment takes more time than the actual SSO configuration. Don't rush it.

2. **SCIM is worth the Entra ID P1 cost.** Manually managing users in both Entra ID and Identity Center defeats the purpose. The automatic provisioning and deprovisioning is what makes this setup sustainable.

3. **The break-glass user is non-negotiable.** SSO depends on an external identity provider. If Entra ID goes down, you need a way into AWS. Store those credentials in a physical safe, not a digital one.

4. **Decommission slowly.** Deactivate keys first, wait 2 to 4 weeks, monitor CloudTrail, then delete. The cost of being careful is low. The cost of breaking a production pipeline because you missed a service account is high.

5. **The parallel-run period is your safety net.** Let both login methods coexist. Don't rush to cut off IAM access. Users will naturally migrate to SSO because it's simpler.

If you're still managing a pile of IAM users with long-lived access keys, this migration is one of the highest-impact security improvements you can make. The setup is a one-time investment; the security and operational benefits last forever.
