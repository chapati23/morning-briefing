#!/usr/bin/env bash
#
# Morning Briefing - Setup and diagnostic script
#
# Usage:
#   ./scripts/setup.sh          # Full interactive setup
#   ./scripts/setup.sh --check  # Check-only mode (no changes)
#   ./scripts/setup.sh -h       # Show help
#
# This script handles the complete setup:
#   1. Check required tools are installed
#   2. Create GCP project (or use existing)
#   3. Create Terraform service account
#   4. Set up configuration files
#   5. Initialize Terraform
#

set -uo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Configuration
SA_NAME="terraform-admin"
SA_KEY_PATH="${HOME}/.config/gcloud/morning-briefing-terraform-sa-key.json"

# Mode flags
CHECK_ONLY=false

# Track status
missing_tools=()
check_issues=0

#=============================================================================
# Help & Argument Parsing
#=============================================================================

show_help() {
	echo "Morning Briefing - Setup Script"
	echo ""
	echo "Usage: $0 [options]"
	echo ""
	echo "Options:"
	echo "  --check, -c    Check-only mode (no changes, just diagnostics)"
	echo "  --help, -h     Show this help message"
	echo ""
	echo "Examples:"
	echo "  $0             Run full interactive setup"
	echo "  $0 --check     Check if everything is configured correctly"
	echo ""
}

parse_args() {
	while [[ $# -gt 0 ]]; do
		case "$1" in
		--check | -c)
			CHECK_ONLY=true
			shift
			;;
		--help | -h)
			show_help
			exit 0
			;;
		*)
			echo -e "${RED}Unknown option: $1${NC}"
			show_help
			exit 1
			;;
		esac
	done
}

#=============================================================================
# Helper Functions
#=============================================================================

print_header() {
	echo ""
	echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
	if [[ ${CHECK_ONLY} == true ]]; then
		echo -e "${BLUE}  Morning Briefing - Setup Check${NC}"
	else
		echo -e "${BLUE}  Morning Briefing - Setup${NC}"
	fi
	echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
	echo ""
}

print_section() {
	echo ""
	echo -e "${BOLD}${BLUE}▸ $1${NC}"
	echo ""
}

print_success() {
	echo -e "  ${GREEN}✓${NC} $1"
}

print_warning() {
	echo -e "  ${YELLOW}○${NC} $1"
}

print_error() {
	echo -e "  ${RED}✗${NC} $1"
}

print_info() {
	echo -e "  ${BLUE}ℹ${NC} $1"
}

prompt() {
	local message="$1"
	local default="${2-}"
	local result

	if [[ -n ${default} ]]; then
		echo -en "  ${BOLD}${message}${NC} [${default}]: " >&2
		read -r result
		echo "${result:-${default}}"
	else
		echo -en "  ${BOLD}${message}${NC}: " >&2
		read -r result
		echo "${result}"
	fi
}

prompt_yes_no() {
	local message="$1"
	local default="${2:-y}"
	local result

	if [[ ${default} == "y" ]]; then
		echo -en "  ${BOLD}${message}${NC} [Y/n]: "
	else
		echo -en "  ${BOLD}${message}${NC} [y/N]: "
	fi

	read -r result
	result="${result:-${default}}"

	[[ ${result} =~ ^[Yy] ]]
}

#=============================================================================
# Tool Checks
#=============================================================================

check_tool() {
	local cmd="$1"
	local install_hint="$2"

	printf "  %-12s " "${cmd}"

	if command -v "${cmd}" &>/dev/null; then
		local version
		version=$("${cmd}" --version 2>&1 | head -n1 | cut -c1-40)
		echo -e "${GREEN}✓${NC} ${version}"
		return 0
	else
		echo -e "${RED}✗ NOT FOUND${NC}"
		echo -e "     ${YELLOW}Install: ${install_hint}${NC}"
		missing_tools+=("${cmd}")
		return 1
	fi
}

check_all_tools() {
	print_section "Checking Required Tools"

	check_tool "bun" "brew install oven-sh/bun/bun"
	check_tool "gcloud" "brew install --cask google-cloud-sdk"
	check_tool "terraform" "brew install terraform"
	check_tool "docker" "brew install --cask docker-desktop"
	check_tool "direnv" "brew install direnv"
	check_tool "git" "brew install git"

	if [[ ${#missing_tools[@]} -gt 0 ]]; then
		# In check mode, don't exit - let the summary handle it
		if [[ ${CHECK_ONLY} == true ]]; then
			return 1
		fi

		echo ""
		print_error "Missing required tools: ${missing_tools[*]}"
		echo ""
		echo -e "  ${YELLOW}Please install the missing tools and run this script again.${NC}"
		echo ""
		echo -e "  ${YELLOW}Quick install (macOS):${NC}"
		for cmd in "${missing_tools[@]}"; do
			case "${cmd}" in
			bun) echo "    brew install oven-sh/bun/bun" ;;
			gcloud) echo "    brew install --cask google-cloud-sdk" ;;
			terraform) echo "    brew install terraform" ;;
			docker) echo "    brew install --cask docker-desktop" ;;
			direnv) echo "    brew install direnv" ;;
			git) echo "    brew install git" ;;
			*) echo "    # Unknown tool: ${cmd}" ;;
			esac
		done
		exit 1
	fi

	print_success "All required tools installed"
}

#=============================================================================
# Check-Only Mode Functions
#=============================================================================

check_direnv_hook() {
	printf "  %-16s " "direnv hook"

	local shell_rc=""
	if [[ -n ${ZSH_VERSION-} ]] || [[ ${SHELL} == "/bin/zsh" ]]; then
		shell_rc="${HOME}/.zshrc"
	elif [[ -n ${BASH_VERSION-} ]] || [[ ${SHELL} == "/bin/bash" ]]; then
		shell_rc="${HOME}/.bashrc"
	fi

	if [[ -n ${shell_rc} ]] && [[ -f ${shell_rc} ]]; then
		if grep -q "direnv hook" "${shell_rc}" 2>/dev/null; then
			echo -e "${GREEN}✓${NC} configured in ${shell_rc}"
			return 0
		fi
	fi

	echo -e "${YELLOW}○${NC} not configured"
	echo -e "     ${YELLOW}Add to your shell rc: eval \"\$(direnv hook zsh)\"${NC}"
	((check_issues++)) || true
	return 1
}

check_envrc() {
	printf "  %-16s " ".envrc"

	if [[ -f ".envrc" ]]; then
		if command -v direnv &>/dev/null && direnv status 2>&1 | grep -q "Found RC allowed true"; then
			echo -e "${GREEN}✓${NC} exists and allowed"
		elif command -v direnv &>/dev/null; then
			echo -e "${YELLOW}○${NC} exists but not allowed"
			echo -e "     ${YELLOW}Run: direnv allow${NC}"
			((check_issues++)) || true
		else
			echo -e "${GREEN}✓${NC} exists"
		fi
		return 0
	else
		echo -e "${YELLOW}○${NC} not found"
		echo -e "     ${YELLOW}Run: ./scripts/setup.sh${NC}"
		((check_issues++)) || true
		return 1
	fi
}

check_env_local() {
	printf "  %-16s " ".env.local"

	if [[ -f ".env.local" ]]; then
		# Check if Telegram credentials are set
		if grep -q "^TELEGRAM_BOT_TOKEN=.\+" .env.local 2>/dev/null; then
			echo -e "${GREEN}✓${NC} exists with Telegram token"
		else
			echo -e "${YELLOW}○${NC} exists but missing Telegram token"
			echo -e "     ${YELLOW}Add TELEGRAM_BOT_TOKEN to .env.local${NC}"
			((check_issues++)) || true
		fi
		return 0
	else
		echo -e "${YELLOW}○${NC} not found"
		echo -e "     ${YELLOW}Run: cp .env.example .env.local${NC}"
		((check_issues++)) || true
		return 1
	fi
}

check_terraform_tfvars() {
	printf "  %-16s " "terraform.tfvars"

	if [[ -f "terraform/terraform.tfvars" ]]; then
		echo -e "${GREEN}✓${NC} exists"
		return 0
	else
		echo -e "${YELLOW}○${NC} not found"
		echo -e "     ${YELLOW}Run: ./scripts/setup.sh${NC}"
		((check_issues++)) || true
		return 1
	fi
}

check_gcloud_project() {
	printf "  %-16s " "gcloud project"

	if ! command -v gcloud &>/dev/null; then
		echo -e "${YELLOW}○${NC} skipped (gcloud not installed)"
		return 1
	fi

	local project
	project=$(gcloud config get-value project 2>/dev/null || echo "")

	if [[ -n ${project} ]] && [[ ${project} != "(unset)" ]]; then
		echo -e "${GREEN}✓${NC} ${project}"
		return 0
	else
		echo -e "${YELLOW}○${NC} no project set"
		echo -e "     ${YELLOW}Run: ./scripts/setup.sh${NC}"
		((check_issues++)) || true
		return 1
	fi
}

check_gcloud_credentials() {
	printf "  %-16s " "TF credentials"

	if [[ -n ${GOOGLE_APPLICATION_CREDENTIALS-} ]] && [[ -f ${GOOGLE_APPLICATION_CREDENTIALS} ]]; then
		echo -e "${GREEN}✓${NC} ${GOOGLE_APPLICATION_CREDENTIALS}"
		return 0
	elif [[ -n ${GOOGLE_APPLICATION_CREDENTIALS-} ]]; then
		echo -e "${RED}✗${NC} File not found: ${GOOGLE_APPLICATION_CREDENTIALS}"
		echo -e "     ${YELLOW}Run: ./scripts/setup.sh${NC}"
		((check_issues++)) || true
		return 1
	else
		# Check for ADC
		local adc_path="${HOME}/.config/gcloud/application_default_credentials.json"
		if [[ -f ${adc_path} ]]; then
			echo -e "${GREEN}✓${NC} application default credentials"
			return 0
		elif [[ -f ${SA_KEY_PATH} ]]; then
			echo -e "${YELLOW}○${NC} key exists but GOOGLE_APPLICATION_CREDENTIALS not set"
			echo -e "     ${YELLOW}Run: direnv allow${NC}"
			((check_issues++)) || true
			return 1
		else
			echo -e "${YELLOW}○${NC} not configured"
			echo -e "     ${YELLOW}Run: ./scripts/setup.sh${NC}"
			((check_issues++)) || true
			return 1
		fi
	fi
}

check_gcloud_auth_status() {
	printf "  %-16s " "gcloud auth"

	if ! command -v gcloud &>/dev/null; then
		echo -e "${YELLOW}○${NC} skipped (gcloud not installed)"
		return 1
	fi

	if gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | grep -q "@"; then
		local account
		account=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -n1)
		echo -e "${GREEN}✓${NC} logged in as ${account}"
		return 0
	else
		echo -e "${YELLOW}○${NC} not authenticated"
		echo -e "     ${YELLOW}Run: gcloud auth login${NC}"
		((check_issues++)) || true
		return 1
	fi
}

run_check_mode() {
	print_header

	print_section "Required Tools"
	check_tool "bun" "brew install oven-sh/bun/bun"
	check_tool "gcloud" "brew install --cask google-cloud-sdk"
	check_tool "terraform" "brew install terraform"
	check_tool "docker" "brew install --cask docker-desktop"
	check_tool "direnv" "brew install direnv"
	check_tool "git" "brew install git"

	print_section "Configuration Files"
	check_direnv_hook
	check_envrc
	check_env_local
	check_terraform_tfvars

	print_section "Google Cloud"
	check_gcloud_auth_status
	check_gcloud_project
	check_gcloud_credentials

	print_section "GitHub CI/CD"
	check_github_variables

	# Summary
	echo ""
	echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
	echo -e "${BLUE}  Summary${NC}"
	echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
	echo ""

	if [[ ${#missing_tools[@]} -eq 0 ]] && [[ ${check_issues} -eq 0 ]]; then
		echo -e "  ${GREEN}✓ All checks passed!${NC}"
		echo ""
		exit 0
	else
		if [[ ${#missing_tools[@]} -gt 0 ]]; then
			echo -e "  ${RED}Missing tools: ${missing_tools[*]}${NC}"
		fi
		if [[ ${check_issues} -gt 0 ]]; then
			echo -e "  ${YELLOW}${check_issues} configuration issue(s) found${NC}"
		fi
		echo ""
		echo -e "  ${BLUE}TIP:${NC} Run ${BOLD}./scripts/setup.sh${NC} (without --check) to fix issues"
		echo ""
		exit 1
	fi
}

#=============================================================================
# Google Cloud Setup
#=============================================================================

check_gcloud_auth() {
	if gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | grep -q "@"; then
		return 0
	fi
	return 1
}

setup_gcloud_auth() {
	print_section "Google Cloud Authentication"

	if check_gcloud_auth; then
		local account
		account=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -n1)
		print_success "Already logged in as ${account}"

		if ! prompt_yes_no "Continue with this account?"; then
			echo ""
			print_info "Running gcloud auth login..."
			gcloud auth login
		fi
	else
		print_warning "Not logged in to Google Cloud"
		echo ""
		print_info "Opening browser for authentication..."
		gcloud auth login

		if ! check_gcloud_auth; then
			print_error "Authentication failed. Please try again."
			exit 1
		fi
	fi
}

setup_gcp_project() {
	print_section "Google Cloud Project"

	# Check for existing project in terraform.tfvars
	local existing_project=""
	if [[ -f "terraform/terraform.tfvars" ]]; then
		existing_project=$(grep -E '^project_id[[:space:]]*=' terraform/terraform.tfvars 2>/dev/null | sed 's/.*=[[:space:]]*"\([^"]*\)".*/\1/' || echo "")
	fi

	# Check current gcloud project
	local current_project
	current_project=$(gcloud config get-value project 2>/dev/null || echo "")

	local project_id=""

	if [[ -n ${existing_project} ]]; then
		print_info "Found project in terraform.tfvars: ${existing_project}"
		if prompt_yes_no "Use this project?"; then
			project_id="${existing_project}"
		fi
	fi

	if [[ -z ${project_id} ]] && [[ -n ${current_project} ]] && [[ ${current_project} != "(unset)" ]]; then
		print_info "Current gcloud project: ${current_project}"
		if prompt_yes_no "Use this project?"; then
			project_id="${current_project}"
		fi
	fi

	if [[ -z ${project_id} ]]; then
		echo ""
		echo -e "  ${YELLOW}Options:${NC}"
		echo "    1. Create a new project"
		echo "    2. Use an existing project"
		echo ""

		if prompt_yes_no "Create a new project?" "y"; then
			local project_name
			project_name=$(prompt "Project name" "morning-briefing")

			# Generate a unique project ID
			local random_suffix
			random_suffix=$(head -c 4 /dev/urandom | xxd -p)
			project_id="${project_name}-${random_suffix}"

			print_info "Creating project: ${project_id}"

			if gcloud projects create "${project_id}" --name="${project_name}" 2>/dev/null; then
				print_success "Project created: ${project_id}"
			else
				print_error "Failed to create project. It may already exist or you lack permissions."
				project_id=$(prompt "Enter existing project ID")
			fi
		else
			project_id=$(prompt "Enter existing project ID")
		fi
	fi

	# Set as current project
	gcloud config set project "${project_id}" 2>/dev/null
	print_success "Using project: ${project_id}"

	# Check billing
	echo ""
	print_info "Checking billing status..."
	local billing_account
	billing_account=$(gcloud billing projects describe "${project_id}" --format="value(billingAccountName)" 2>/dev/null || echo "")

	if [[ -z ${billing_account} ]] || [[ ${billing_account} == "billingAccountName: ''" ]]; then
		print_warning "Billing is not enabled for this project"
		echo ""
		echo -e "  ${YELLOW}Billing is required for GCP services.${NC}"
		echo -e "  ${YELLOW}Please enable billing at:${NC}"
		echo -e "  ${BLUE}https://console.cloud.google.com/billing/linkedaccount?project=${project_id}${NC}"
		echo ""

		if ! prompt_yes_no "Continue anyway? (You'll need to enable billing before terraform apply)"; then
			exit 1
		fi
	else
		print_success "Billing is enabled"
	fi

	# Enable Cloud Resource Manager API (required for Terraform to manage other APIs)
	echo ""
	print_info "Enabling Cloud Resource Manager API (required for Terraform)..."
	if gcloud services enable cloudresourcemanager.googleapis.com --project="${project_id}" 2>/dev/null; then
		print_success "Cloud Resource Manager API enabled"
		# Wait for API to propagate
		sleep 5
	else
		print_warning "Could not enable Cloud Resource Manager API automatically"
		echo -e "  ${YELLOW}Please enable it manually at:${NC}"
		echo -e "  ${BLUE}https://console.cloud.google.com/apis/api/cloudresourcemanager.googleapis.com/overview?project=${project_id}${NC}"
	fi

	# Store for later use
	GCP_PROJECT_ID="${project_id}"
}

setup_service_account() {
	print_section "Terraform Service Account"

	local sa_email="${SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"

	# Check if service account exists
	if gcloud iam service-accounts describe "${sa_email}" --project="${GCP_PROJECT_ID}" &>/dev/null; then
		print_success "Service account exists: ${sa_email}"
	else
		print_info "Creating service account: ${SA_NAME}"

		if gcloud iam service-accounts create "${SA_NAME}" \
			--display-name="Terraform Admin" \
			--project="${GCP_PROJECT_ID}" 2>/dev/null; then
			print_success "Service account created"
		else
			print_error "Failed to create service account"
			exit 1
		fi
	fi

	# Check if Owner role is already granted
	if gcloud projects get-iam-policy "${GCP_PROJECT_ID}" \
		--flatten="bindings[].members" \
		--format="value(bindings.members)" \
		--filter="bindings.role=roles/owner" 2>/dev/null | grep -q "serviceAccount:${sa_email}"; then
		print_success "Owner role already granted"
	else
		print_info "Granting Owner role..."
		if gcloud projects add-iam-policy-binding "${GCP_PROJECT_ID}" \
			--member="serviceAccount:${sa_email}" \
			--role="roles/owner" \
			--condition=None \
			--quiet 2>/dev/null; then
			print_success "Owner role granted"
		else
			print_warning "Could not grant role"
		fi
	fi

	# Create key if it doesn't exist
	if [[ -f ${SA_KEY_PATH} ]]; then
		print_success "Service account key exists"
		return 0
	fi

	print_info "Creating service account key..."
	mkdir -p "$(dirname "${SA_KEY_PATH}")"

	if gcloud iam service-accounts keys create "${SA_KEY_PATH}" \
		--iam-account="${sa_email}" 2>/dev/null; then
		chmod 600 "${SA_KEY_PATH}"
		print_success "Key saved to ${SA_KEY_PATH}"
	else
		print_error "Failed to create service account key"
		exit 1
	fi
}

#=============================================================================
# Configuration Files
#=============================================================================

setup_config_files() {
	print_section "Configuration Files"

	# .envrc
	if [[ ! -f ".envrc" ]]; then
		if [[ -f ".envrc.example" ]]; then
			cp .envrc.example .envrc
			print_success "Created .envrc from template"
		else
			cat >.envrc <<EOF
# Auto-configure GCloud CLI when entering this directory
export CLOUDSDK_CORE_PROJECT="${GCP_PROJECT_ID}"
export GOOGLE_CLOUD_PROJECT="${GCP_PROJECT_ID}"

# Terraform service account credentials
export GOOGLE_APPLICATION_CREDENTIALS="${SA_KEY_PATH}"
EOF
			print_success "Created .envrc"
		fi
	else
		print_info ".envrc already exists, updating..."
	fi

	# Ensure GOOGLE_APPLICATION_CREDENTIALS is in .envrc
	if ! grep -q "GOOGLE_APPLICATION_CREDENTIALS" .envrc 2>/dev/null; then
		{
			echo ""
			echo "# Terraform service account credentials"
			echo "export GOOGLE_APPLICATION_CREDENTIALS=\"${SA_KEY_PATH}\""
		} >>.envrc
		print_success "Added GOOGLE_APPLICATION_CREDENTIALS to .envrc"
	fi

	# Update project ID in .envrc if different
	if grep -q "CLOUDSDK_CORE_PROJECT" .envrc; then
		sed -i.bak "s/CLOUDSDK_CORE_PROJECT=.*/CLOUDSDK_CORE_PROJECT=\"${GCP_PROJECT_ID}\"/" .envrc
		sed -i.bak "s/GOOGLE_CLOUD_PROJECT=.*/GOOGLE_CLOUD_PROJECT=\"${GCP_PROJECT_ID}\"/" .envrc
		rm -f .envrc.bak
	fi

	# .env.local
	if [[ ! -f ".env.local" ]]; then
		if [[ -f ".env.example" ]]; then
			cp .env.example .env.local
			print_success "Created .env.local from template"
			print_warning "You'll need to add your Telegram credentials to .env.local"
		fi
	else
		print_success ".env.local exists"
	fi

	# terraform/terraform.tfvars
	if [[ ! -f "terraform/terraform.tfvars" ]]; then
		if [[ -f "terraform/terraform.tfvars.example" ]]; then
			cp terraform/terraform.tfvars.example terraform/terraform.tfvars
			print_success "Created terraform/terraform.tfvars from template"
		fi
	fi

	# Update terraform.tfvars with project ID
	if [[ -f "terraform/terraform.tfvars" ]]; then
		# Update project_id
		sed -i.bak "s/^project_id = .*/project_id = \"${GCP_PROJECT_ID}\"/" terraform/terraform.tfvars
		rm -f terraform/terraform.tfvars.bak
		print_success "Updated terraform.tfvars with project ID"

		# Prompt for GitHub repo if still using placeholder from example
		if grep -q 'github_repo = "youruser/morning-briefing"' terraform/terraform.tfvars; then
			echo ""
			local github_user
			github_user=$(prompt "GitHub username" "")

			if [[ -n ${github_user} ]]; then
				sed -i.bak "s|^github_repo = .*|github_repo = \"${github_user}/morning-briefing\"|" terraform/terraform.tfvars
				rm -f terraform/terraform.tfvars.bak
				print_success "Updated github_repo to ${github_user}/morning-briefing"
			fi
		fi
	fi

	# Allow direnv
	if command -v direnv &>/dev/null; then
		direnv allow . 2>/dev/null || true
		print_success "Allowed direnv"
	fi
}

#=============================================================================
# GitHub Variables
#=============================================================================

check_github_variables() {
	# Extract github_repo from terraform.tfvars
	local github_repo=""
	if [[ -f "terraform/terraform.tfvars" ]]; then
		github_repo=$(grep -E '^github_repo[[:space:]]*=' terraform/terraform.tfvars 2>/dev/null | sed 's/.*=[[:space:]]*"\([^"]*\)".*/\1/' || echo "")
	fi

	if [[ -z ${github_repo} ]]; then
		print_warning "github_repo not set in terraform.tfvars"
		((check_issues++))
		return 1
	fi

	if ! command -v gh &>/dev/null; then
		print_warning "gh CLI not installed (GitHub variables not checked)"
		echo -e "  ${YELLOW}Install with: brew install gh${NC}"
		((check_issues++))
		return 1
	fi

	if ! gh auth status &>/dev/null; then
		print_warning "gh CLI not authenticated"
		echo -e "  ${YELLOW}Run: gh auth login${NC}"
		((check_issues++))
		return 1
	fi

	local project_id_set=false
	local region_set=false

	if gh variable list --repo "${github_repo}" 2>/dev/null | grep -q "^GCP_PROJECT_ID"; then
		project_id_set=true
	fi

	if gh variable list --repo "${github_repo}" 2>/dev/null | grep -q "^GCP_REGION"; then
		region_set=true
	fi

	if [[ ${project_id_set} == true ]] && [[ ${region_set} == true ]]; then
		print_success "GitHub variables configured (GCP_PROJECT_ID, GCP_REGION)"
		return 0
	else
		local missing=""
		[[ ${project_id_set} == false ]] && missing="GCP_PROJECT_ID"
		[[ ${region_set} == false ]] && missing="${missing:+${missing}, }GCP_REGION"
		print_warning "GitHub variables not set: ${missing}"
		((check_issues++))
		return 1
	fi
}

setup_github_variables() {
	print_section "GitHub Repository Variables"

	# Extract region from terraform.tfvars (or use default)
	if [[ -f "terraform/terraform.tfvars" ]]; then
		GCP_REGION=$(grep -E '^region[[:space:]]*=' terraform/terraform.tfvars 2>/dev/null | sed 's/.*=[[:space:]]*"\([^"]*\)".*/\1/' || echo "")
	fi
	GCP_REGION="${GCP_REGION:-europe-west1}"

	# Extract github_repo from terraform.tfvars
	local github_repo=""
	if [[ -f "terraform/terraform.tfvars" ]]; then
		github_repo=$(grep -E '^github_repo[[:space:]]*=' terraform/terraform.tfvars 2>/dev/null | sed 's/.*=[[:space:]]*"\([^"]*\)".*/\1/' || echo "")
	fi

	if [[ -z ${github_repo} ]]; then
		print_warning "github_repo not set in terraform.tfvars - skipping GitHub variables"
		return 0
	fi

	# Check if gh CLI is available
	if ! command -v gh &>/dev/null; then
		print_warning "gh CLI not installed - skipping GitHub variables"
		echo ""
		echo -e "  ${YELLOW}To enable CI/CD, install gh and run:${NC}"
		echo -e "  ${BLUE}brew install gh${NC}"
		echo -e "  ${BLUE}gh auth login${NC}"
		echo -e "  ${BLUE}gh variable set GCP_PROJECT_ID --body \"${GCP_PROJECT_ID}\" --repo \"${github_repo}\"${NC}"
		echo -e "  ${BLUE}gh variable set GCP_REGION --body \"${GCP_REGION}\" --repo \"${github_repo}\"${NC}"
		echo ""
		return 0
	fi

	# Check if authenticated
	if ! gh auth status &>/dev/null; then
		print_warning "gh CLI not authenticated - skipping GitHub variables"
		echo ""
		echo -e "  ${YELLOW}To enable CI/CD, authenticate and run:${NC}"
		echo -e "  ${BLUE}gh auth login${NC}"
		echo -e "  ${BLUE}gh variable set GCP_PROJECT_ID --body \"${GCP_PROJECT_ID}\" --repo \"${github_repo}\"${NC}"
		echo -e "  ${BLUE}gh variable set GCP_REGION --body \"${GCP_REGION}\" --repo \"${github_repo}\"${NC}"
		echo ""
		return 0
	fi

	print_info "Configuring variables for ${github_repo}"

	# Check and set GCP_PROJECT_ID
	local current_project_id
	current_project_id=$(gh variable list --repo "${github_repo}" 2>/dev/null | grep "^GCP_PROJECT_ID" | awk '{print $2}' || echo "")

	if [[ -n ${current_project_id} ]]; then
		if [[ ${current_project_id} == "${GCP_PROJECT_ID}" ]]; then
			print_success "GCP_PROJECT_ID already set to ${GCP_PROJECT_ID}"
		else
			print_info "GCP_PROJECT_ID is set to ${current_project_id} (expected: ${GCP_PROJECT_ID})"
			if prompt_yes_no "Update to ${GCP_PROJECT_ID}?"; then
				gh variable set GCP_PROJECT_ID --body "${GCP_PROJECT_ID}" --repo "${github_repo}"
				print_success "Updated GCP_PROJECT_ID"
			fi
		fi
	else
		print_info "Setting GCP_PROJECT_ID to ${GCP_PROJECT_ID}"
		if gh variable set GCP_PROJECT_ID --body "${GCP_PROJECT_ID}" --repo "${github_repo}"; then
			print_success "GCP_PROJECT_ID set"
		else
			print_error "Failed to set GCP_PROJECT_ID"
		fi
	fi

	# Check and set GCP_REGION
	local current_region
	current_region=$(gh variable list --repo "${github_repo}" 2>/dev/null | grep "^GCP_REGION" | awk '{print $2}' || echo "")

	if [[ -n ${current_region} ]]; then
		if [[ ${current_region} == "${GCP_REGION}" ]]; then
			print_success "GCP_REGION already set to ${GCP_REGION}"
		else
			print_info "GCP_REGION is set to ${current_region} (expected: ${GCP_REGION})"
			if prompt_yes_no "Update to ${GCP_REGION}?"; then
				gh variable set GCP_REGION --body "${GCP_REGION}" --repo "${github_repo}"
				print_success "Updated GCP_REGION"
			fi
		fi
	else
		print_info "Setting GCP_REGION to ${GCP_REGION}"
		if gh variable set GCP_REGION --body "${GCP_REGION}" --repo "${github_repo}"; then
			print_success "GCP_REGION set"
		else
			print_error "Failed to set GCP_REGION"
		fi
	fi
}

#=============================================================================
# Terraform Init
#=============================================================================

setup_terraform() {
	print_section "Terraform Initialization"

	# Export credentials for this session
	export GOOGLE_APPLICATION_CREDENTIALS="${SA_KEY_PATH}"

	cd terraform || exit

	if [[ -d ".terraform" ]]; then
		print_info ".terraform directory exists"
		if prompt_yes_no "Re-initialize terraform?" "n"; then
			rm -rf .terraform
		else
			print_success "Skipping terraform init"
			cd ..
			return 0
		fi
	fi

	print_info "Running terraform init..."
	if terraform init; then
		print_success "Terraform initialized"
	else
		print_error "Terraform init failed"
		cd ..
		exit 1
	fi

	cd ..
}

#=============================================================================
# Final Summary
#=============================================================================

print_summary() {
	echo ""
	echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
	echo -e "${BLUE}  Setup Complete!${NC}"
	echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
	echo ""
	echo -e "  ${GREEN}✓${NC} GCP Project: ${BOLD}${GCP_PROJECT_ID}${NC}"
	echo -e "  ${GREEN}✓${NC} Service Account: ${BOLD}${SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com${NC}"
	echo -e "  ${GREEN}✓${NC} Credentials: ${BOLD}${SA_KEY_PATH}${NC}"
	echo ""
	echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
	echo -e "${BLUE}  Next Steps${NC}"
	echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
	echo ""

	# Check if Telegram credentials are set
	if [[ -f ".env.local" ]] && grep -q "^TELEGRAM_BOT_TOKEN=.\+" .env.local 2>/dev/null; then
		echo -e "  ${GREEN}1.${NC} Test locally:"
		echo -e "     ${BOLD}bun dev${NC}"
		echo ""
		echo -e "  ${GREEN}2.${NC} Deploy to GCP (builds image, creates infra):"
		echo -e "     ${BOLD}cd terraform && make deploy${NC}"
	else
		echo -e "  ${YELLOW}1.${NC} Set up Telegram bot:"
		echo -e "     - Create a bot with @BotFather: https://t.me/botfather"
		echo -e "     - Add the token to .env.local"
		echo -e "     - Run: ${BOLD}bun run get-chat-id${NC}"
		echo -e "     - Add the chat ID to .env.local"
		echo ""
		echo -e "  ${GREEN}2.${NC} Test locally:"
		echo -e "     ${BOLD}bun dev${NC}"
		echo ""
		echo -e "  ${GREEN}3.${NC} Deploy to GCP (builds image, creates infra):"
		echo -e "     ${BOLD}cd terraform && make deploy${NC}"
	fi

	echo ""
	echo -e "  ${BLUE}Documentation:${NC} docs/deploy-from-scratch.md"
	echo ""
}

#=============================================================================
# Main
#=============================================================================

main() {
	# Parse command line arguments
	parse_args "$@"

	# Ensure we're in the repo root
	if [[ ! -f "package.json" ]] || [[ ! -d "terraform" ]]; then
		echo -e "${RED}Error: Please run this script from the repository root${NC}"
		exit 1
	fi

	# Run check-only mode if requested
	if [[ ${CHECK_ONLY} == true ]]; then
		run_check_mode # exits internally
	fi

	# Full setup mode
	print_header

	check_all_tools
	setup_gcloud_auth
	setup_gcp_project
	setup_service_account
	setup_config_files
	setup_github_variables
	setup_terraform
	print_summary
}

main "$@"
