# Terraform Makefile
# Reads secrets from ../.env.local to avoid duplication

ENV_FILE := ../.env.local

# Read config from terraform.tfvars
PROJECT_ID := $(shell grep 'project_id' terraform.tfvars 2>/dev/null | cut -d'"' -f2)
REGION := $(shell grep 'region' terraform.tfvars 2>/dev/null | cut -d'"' -f2)
IMAGE_URL := $(REGION)-docker.pkg.dev/$(PROJECT_ID)/morning-briefing/app:latest

# Helper to load env vars for Terraform
define TF_VARS
	set -a && . $(ENV_FILE) && set +a && \
	TF_VAR_telegram_bot_token="$$TELEGRAM_BOT_TOKEN" \
	TF_VAR_telegram_chat_id="$$TELEGRAM_CHAT_ID" \
	TF_VAR_timezone="$$TIMEZONE" \
	TF_VAR_agentmail_api_key="$$AGENTMAIL_API_KEY" \
	TF_VAR_agentmail_email_address="$$AGENTMAIL_EMAIL_ADDRESS"
endef

.PHONY: help init plan apply destroy output fmt validate build push deploy setup-github-secrets

help: ## Show this help
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'
	@echo ""
	@echo "First-time setup:  make deploy"
	@echo "Subsequent updates: make deploy (or just push to main)"
	@echo ""
	@echo "Project: $(PROJECT_ID), Region: $(REGION)"

init: ## Initialize Terraform (download providers)
	terraform init

build: ## Build Docker image locally (with BuildKit caching)
	@echo "Building Docker image with BuildKit..."
	cd .. && DOCKER_BUILDKIT=1 docker build \
		--platform linux/amd64 \
		--build-arg BUILDKIT_INLINE_CACHE=1 \
		-t $(IMAGE_URL) .
	@echo "Image built: $(IMAGE_URL)"

push: ## Push Docker image to Artifact Registry (creates registry if needed)
	@echo "Configuring Docker for Artifact Registry..."
	@gcloud auth configure-docker $(REGION)-docker.pkg.dev --quiet
	@echo "Pushing image to $(IMAGE_URL)..."
	@if ! docker push $(IMAGE_URL) 2>/dev/null; then \
		echo "Registry doesn't exist yet, creating it first..."; \
		$(TF_VARS) terraform apply -target=google_artifact_registry_repository.docker -target=google_project_service.apis -auto-approve; \
		echo "Retrying push..."; \
		docker push $(IMAGE_URL); \
	fi
	@echo "Image pushed successfully"

deploy: init build push apply ## Full deployment: init, build, push, apply (use for first-time setup)
	@echo ""
	@echo "Deployment complete! Run 'make setup-github-secrets' to enable CI/CD."

setup-github-secrets: ## Set GitHub Actions secrets from Terraform outputs (run after deploy)
	@echo "Setting up GitHub Actions secrets..."
	@GITHUB_REPO=$$(grep 'github_repo' terraform.tfvars 2>/dev/null | cut -d'"' -f2); \
	WIF_PROVIDER=$$(terraform output -raw workload_identity_provider 2>/dev/null); \
	WIF_SA=$$(terraform output -raw service_account_email 2>/dev/null); \
	if [ -z "$$GITHUB_REPO" ]; then \
		echo "Error: github_repo not found in terraform.tfvars"; \
		exit 1; \
	fi; \
	if [ -z "$$WIF_PROVIDER" ] || [ -z "$$WIF_SA" ]; then \
		echo "Error: Terraform outputs not found. Run 'make deploy' first."; \
		exit 1; \
	fi; \
	echo "Repository: $$GITHUB_REPO"; \
	echo "WIF Provider: $$WIF_PROVIDER"; \
	echo "Service Account: $$WIF_SA"; \
	echo ""; \
	gh secret set WIF_PROVIDER --body "$$WIF_PROVIDER" --repo "$$GITHUB_REPO" && \
	gh secret set WIF_SERVICE_ACCOUNT --body "$$WIF_SA" --repo "$$GITHUB_REPO" && \
	echo "" && \
	echo "GitHub Actions secrets configured successfully!"

plan: ## Preview infrastructure changes
	@$(TF_VARS) terraform plan

apply: ## Apply infrastructure changes (with approval prompt)
	@$(TF_VARS) terraform apply

destroy: ## Destroy all infrastructure (with approval prompt)
	@$(TF_VARS) terraform destroy

output: ## Show Terraform outputs
	terraform output

fmt: ## Format Terraform files
	terraform fmt -recursive

validate: ## Validate Terraform configuration
	terraform validate
