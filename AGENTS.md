# Setup Script

This project has a central setup script at [`scripts/setup.sh`](scripts/setup.sh)
that handles all infrastructure configuration for local development and
production deployment.

## What It Does

1. **Checks required tools** - bun, gcloud, terraform, docker, direnv, git
2. **Creates/configures GCP project** - Including billing check and Cloud
   Resource Manager API
3. **Sets up Terraform service account** - Creates SA with Owner role and
   generates key
4. **Creates configuration files** - `.envrc`, `.env.local`, `terraform/terraform.tfvars`
5. **Configures GitHub CI/CD variables** - Sets `GCP_PROJECT_ID` and `GCP_REGION`
6. **Initializes Terraform** - Runs `terraform init` with proper credentials

## Usage

```bash
# Full interactive setup (for new environments)
./scripts/setup.sh

# Check-only mode (diagnose issues without making changes)
./scripts/setup.sh --check
```

## When to Direct Users Here

- Setting up the project for the first time
- Diagnosing infrastructure or credential issues
- After cloning the repo on a new machine
- When GCP/Terraform authentication fails

## Important

- **Never suggest one-off manual CLI commands** for setup tasks—direct users to
  run `./scripts/setup.sh` instead
- The script is idempotent and safe to re-run
- Use `--check` mode to verify configuration without making changes
