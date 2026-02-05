# Deploy Morning Briefing from Scratch

This guide walks you through deploying your own instance of the Morning Briefing
service from zero to a fully running system.

## Quick Start (Recommended)

```bash
# 1. Clone and install
git clone https://github.com/chapati23/morning-briefing.git && cd morning-briefing
bun install

# 2. Run setup (checks local env, creates GCP resources, configures auth)
bun setup

# 3. Add your Telegram credentials to .env.local
#    (see "Step 1: Create a Telegram Bot" below for how to get these)

# 4. Deploy everything
cd terraform && make deploy

# 5. Enable CI/CD (optional but recommended)
make setup-github-secrets
```

That's it! The `make deploy` command handles everything:

- Initializes Terraform
- Builds your Docker image locally
- Creates the Artifact Registry (if needed)
- Pushes your image
- Creates all GCP infrastructure (Cloud Run, Scheduler, etc.)

After deployment, `make setup-github-secrets` configures GitHub Actions for
automatic deployments on every push to main.

---

## Manual Setup

If you prefer to set things up manually, or the script doesn't work for your
environment, follow the detailed steps below.

## Overview

Morning Briefing is a daily notification service that aggregates financial data
(ETF flows, economic calendar, prediction markets) and sends it to you via
Telegram. It runs on Google Cloud Platform using:

- **Cloud Run** - Serverless container hosting
- **Cloud Scheduler** - Daily trigger
- **Cloud Storage** - ICS calendar files served via CDN for instant downloads
- **Artifact Registry** - Docker image storage
- **Secret Manager** - Secure credential storage
- **GitHub Actions** - CI/CD pipeline

**Estimated cost: $0/month** (within GCP free tier for once-daily usage)

---

## Prerequisites Checklist

Before starting, ensure you have:

- [ ] Google Cloud account with billing enabled
- [ ] GitHub account
- [ ] Telegram account
- [ ] Local development environment with:
  - [ ] [Docker](https://docs.docker.com/get-docker/) installed (for building images)
  - [ ] [gcloud CLI](https://cloud.google.com/sdk/docs/install) installed
  - [ ] [Terraform](https://developer.hashicorp.com/terraform/install) (v1.3+) installed
  - [ ] [Bun](https://bun.sh) installed (for local testing)
  - [ ] Git installed

---

## Step 1: Create a Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot` and follow the prompts to create a new bot
3. Save the **bot token** (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
4. Start a conversation with your new bot (search for it and click "Start")

### Get Your Chat ID

```bash
# Clone the repository
git clone https://github.com/YOUR_USER/morning-briefing.git
cd morning-briefing

# Install dependencies
bun install

# Create local env file
cp .env.example .env.local

# Add your bot token to .env.local
# TELEGRAM_BOT_TOKEN=your_token_here

# Run the helper script
bun run get-chat-id
```

Send a message to your bot, and the script will print your chat ID. Save this value.

---

## Step 2: Create a GCP Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Click "Select a project" → "New Project"
3. Enter a project name (e.g., `morning-briefing`)
4. Note the **Project ID** (may differ from the name)
5. Click "Create"
6. Ensure billing is enabled for the project:
   - Go to "Billing" in the console
   - Link a billing account to your project

### Authenticate gcloud CLI

```bash
# Log in to Google Cloud
gcloud auth login

# Set your project
gcloud config set project YOUR_PROJECT_ID
```

### Set up Terraform Credentials

Terraform needs credentials to manage GCP resources. You have two options:

#### Option A: Application Default Credentials (may be blocked)

```bash
gcloud auth application-default login
```

#### Option B: Service Account Key (recommended)

If `application-default login` shows "This app is blocked", create a service account:

```bash
# Create service account
gcloud iam service-accounts create terraform-admin \
  --display-name="Terraform Admin"

# Grant Owner role (replace YOUR_PROJECT_ID)
SA="terraform-admin@YOUR_PROJECT_ID.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:$SA" --role="roles/owner"

# Create and download key
gcloud iam service-accounts keys create \
  ~/.config/gcloud/morning-briefing-terraform-sa-key.json \
  --iam-account=terraform-admin@YOUR_PROJECT_ID.iam.gserviceaccount.com

# Add to your .envrc
export_line='export GOOGLE_APPLICATION_CREDENTIALS='
export_line+='"$HOME/.config/gcloud/morning-briefing-terraform-sa-key.json"'
echo "$export_line" >> .envrc
direnv allow
```

> **TIP**: The `./scripts/setup.sh` script handles all of this automatically!

---

## Step 3: Fork/Clone the Repository

If you haven't already:

```bash
# Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR_USER/morning-briefing.git
cd morning-briefing
```

---

## Step 4: Configure Your Environment

Configuration is split between two files to avoid duplication:

- **`.env.local`** - Secrets and app config (single source of truth)
- **`terraform/terraform.tfvars`** - Infrastructure config only

### 4a: Configure .env.local (secrets + app config)

```bash
# From repo root
cp .env.example .env.local
```

Edit `.env.local` with your Telegram credentials (from Step 1):

```bash
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=-1001234567890

# App Config
TIMEZONE=Europe/Berlin
USE_MOCK_DATA=false
LOG_LEVEL=info
```

### 4b: Configure terraform.tfvars (infrastructure only)

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:

```hcl
# GCP Project Configuration
project_id = "your-project-id"        # From Step 2
region     = "europe-west1"           # Or your preferred region

# GitHub Repository
github_repo = "your-user/morning-briefing"  # Your GitHub username/repo

# Schedule Configuration
schedule_cron = "0 7 * * *"          # 7:00 AM daily (adjust as needed)
```

**Note**: Secrets are read from `.env.local` via the Makefile - no duplication!

---

## Step 5: Deploy to GCP

Use the Makefile for simple commands that automatically load secrets from `.env.local`:

```bash
cd terraform

# Full deployment: init, build image, push, create infrastructure
make deploy

# See all available commands
make help
```

The `make deploy` command:

1. Initializes Terraform (downloads providers)
2. Builds your Docker image locally
3. Creates Artifact Registry if it doesn't exist
4. Pushes your image to Artifact Registry
5. Creates all remaining infrastructure

This creates:

- Artifact Registry repository
- Secret Manager secrets
- Cloud Storage bucket (for ICS calendar files)
- Cloud Run service (with your app image)
- Cloud Scheduler job (triggers daily briefing)
- Workload Identity Federation for GitHub Actions
- All necessary IAM bindings

### Note the Outputs

After `make deploy` completes, note these values for GitHub Actions:

```bash
make output
# Or specifically:
terraform output workload_identity_provider
terraform output service_account_email
```

### Other Useful Commands

```bash
make plan                 # Preview changes without applying
make apply                # Apply changes (when image already exists)
make build                # Just build Docker image
make push                 # Just push image to registry
make setup-github-secrets # Set GitHub Actions secrets (run after first deploy)
```

---

## Step 6: Configure GitHub Secrets

After `make deploy` completes, set up GitHub Actions secrets:

```bash
# Automatically sets WIF_PROVIDER and WIF_SERVICE_ACCOUNT from Terraform outputs
make setup-github-secrets
```

This requires the `gh` CLI to be installed and authenticated (`gh auth login`).

### Manual Alternative

If you prefer to set secrets manually, go to your GitHub repository → Settings →
Secrets and variables → Actions, and add:

| Secret Name           | Value                                         |
| --------------------- | --------------------------------------------- |
| `WIF_PROVIDER`        | `terraform output workload_identity_provider` |
| `WIF_SERVICE_ACCOUNT` | `terraform output service_account_email`      |

---

## Step 7: Enable Automatic Deployments (Optional)

After the initial `make deploy`, you can enable automatic deployments via GitHub
Actions. Every push to `main` will automatically build, test, and deploy.

Push your configuration to trigger the first GitHub Actions run:

```bash
cd ..  # Back to repo root
git add .
git commit -m "Configure deployment infrastructure"
git push origin main
```

GitHub Actions will:

1. Run tests and linting
2. Build the Docker image
3. Push to Artifact Registry
4. Deploy to Cloud Run

Monitor the workflow in GitHub → Actions tab.

### Manual Deployments

You can also deploy manually at any time:

```bash
cd terraform && make deploy
```

---

## Step 8: Verify Deployment

### Check Cloud Run Logs

```bash
# Replace YOUR_REGION with your configured region (e.g., europe-west1)
gcloud run logs read morning-briefing --region=YOUR_REGION --limit=50
```

### Test the Endpoint Manually

```bash
# Get the service URL
SERVICE_URL=$(cd terraform && terraform output -raw service_url)

# Test the health endpoint
curl "$SERVICE_URL/health"

# Trigger a briefing manually (requires authentication)
curl -X POST "$SERVICE_URL/briefing" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)"
```

### Test the Scheduler

```bash
# Replace YOUR_REGION with your configured region
gcloud scheduler jobs run morning-briefing-trigger --location=YOUR_REGION
```

You should receive a Telegram message with your morning briefing!

---

## Configuration Reference

### Configuration Files

| File                 | Purpose        | Contains                    |
| -------------------- | -------------- | --------------------------- |
| `.env.local`         | Secrets + app  | Telegram creds, `TIMEZONE`  |
| `terraform/*.tfvars` | Infrastructure | `project_id`, `region`, etc |

### .env.local Variables

| Variable             | Description               | Example               |
| -------------------- | ------------------------- | --------------------- |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | `123456789:ABCdef...` |
| `TELEGRAM_CHAT_ID`   | Your Telegram chat ID     | `-1001234567890`      |
| `TIMEZONE`           | Timezone for scheduler    | `Europe/Berlin`       |
| `LOG_LEVEL`          | Logging verbosity         | `info` or `debug`     |
| `USE_MOCK_DATA`      | Use mock data sources     | `false`               |

### terraform.tfvars Variables

| Variable        | Description              | Default       |
| --------------- | ------------------------ | ------------- |
| `project_id`    | GCP project ID           | (required)    |
| `region`        | GCP region               | `us-central1` |
| `github_repo`   | GitHub repo (owner/name) | (required)    |
| `schedule_cron` | Cron expression          | `0 7 * * *`   |

### Cron Schedule Examples

| Schedule            | Cron Expression |
| ------------------- | --------------- |
| 7:00 AM daily       | `0 7 * * *`     |
| 8:30 AM weekdays    | `30 8 * * 1-5`  |
| 6:00 AM and 6:00 PM | `0 6,18 * * *`  |
| Every 6 hours       | `0 */6 * * *`   |

### Supported Timezones

Use IANA timezone names: `America/New_York`, `Europe/London`, `Asia/Tokyo`, etc.
Full list: <https://en.wikipedia.org/wiki/List_of_tz_database_time_zones>

---

## Cost Breakdown

### Free Tier Included

| Service           | Free Tier                  | Your Usage               |
| ----------------- | -------------------------- | ------------------------ |
| Cloud Run         | 2M requests, 360k vCPU-sec | ~30 requests/month       |
| Cloud Scheduler   | 3 jobs                     | 1 job                    |
| Cloud Storage     | 5 GB storage, 1 GB egress  | ~1 MB/month (ICS files)  |
| Artifact Registry | 500 MB                     | ~500 MB (one image)      |
| Secret Manager    | 6 secrets, 10k access ops  | 2 secrets, ~60 ops/month |

**Total estimated cost: $0/month** for typical usage.

### What Could Cost Money

- **Cloud Run**: If you trigger briefings very frequently (>60k times/month)
- **Cloud Storage**: If ICS files are downloaded very frequently (>1GB egress/month)
- **Artifact Registry**: If you keep many old image versions (>500MB)
- **Network egress**: If you add many external API calls (first 1GB/month free)

---

## Troubleshooting

### GitHub Actions: "Permission denied" or "Not authorized"

1. Verify WIF_PROVIDER and WIF_SERVICE_ACCOUNT secrets are set correctly
2. Check that `github_repo` in `terraform.tfvars` matches your actual repo
3. Re-run `terraform apply` to ensure Workload Identity is configured

### Cloud Run: Container fails to start

1. Check logs: `gcloud run logs read morning-briefing --region=YOUR_REGION`
2. Verify secrets exist: `gcloud secrets list`
3. Ensure the image was pushed: check Artifact Registry in GCP Console

### Scheduler: "Permission denied" when invoking Cloud Run

1. Verify scheduler service account has `roles/run.invoker`
2. Re-run `terraform apply` to fix IAM bindings

### Telegram: No messages received

1. Verify bot token and chat ID are correct
2. Ensure you've started a conversation with your bot
3. Check Cloud Run logs for errors
4. Test locally: `bun dev --dry-run`

### Terraform: "API not enabled"

```bash
# Manually enable required APIs
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com
```

---

## Customization

### Change the Schedule

Edit `terraform/terraform.tfvars`:

```hcl
schedule_cron = "30 8 * * 1-5"  # 8:30 AM weekdays only
```

Then apply the change:

```bash
cd terraform && make apply  # No rebuild needed for infra-only changes
```

### Add New Data Sources

1. Create a new source file in `src/sources/`
2. Register it in `src/sources/index.ts`
3. Push to main to deploy

### Change Notification Channel

The codebase supports multiple channels. See `src/channels/` for implementation
details.

---

## Tear Down

To remove all GCP resources:

```bash
cd terraform
make destroy
```

This removes:

- Cloud Run service
- Cloud Scheduler job
- Cloud Storage bucket (and all ICS files)
- Artifact Registry (and all images)
- Secret Manager secrets
- Workload Identity Federation
- All IAM bindings

**Note**: This does not delete the GCP project itself. Delete that manually in
the console if desired.

---

## Support

- **Issues**: Open a GitHub issue for bugs or feature requests
- **Discussions**: Use GitHub Discussions for questions

---

## License

MIT License - see [LICENSE](../LICENSE) for details.
