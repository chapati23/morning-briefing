variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for resources"
  type        = string
  default     = "us-central1"
}

variable "github_repo" {
  description = "GitHub repository in format owner/repo (e.g., youruser/morning-briefing)"
  type        = string
}

variable "telegram_bot_token" {
  description = "Telegram bot token from @BotFather"
  type        = string
  sensitive   = true
}

variable "telegram_chat_id" {
  description = "Telegram chat ID for notifications"
  type        = string
  sensitive   = true
}

variable "timezone" {
  description = "Timezone for the scheduler (e.g., Europe/Berlin, America/New_York)"
  type        = string
  default     = "Europe/Berlin"
}

variable "schedule_cron" {
  description = "Cron expression for daily briefing schedule"
  type        = string
  default     = "0 7 * * *" # 7:00 AM daily
}


variable "agentmail_api_key" {
  description = "AgentMail API key for OpenSea Voyages email-based OTP login (from https://console.agentmail.to)"
  type        = string
  sensitive   = true

  validation {
    condition     = length(trimspace(var.agentmail_api_key)) > 0
    error_message = "agentmail_api_key must be non-empty. Set AGENTMAIL_API_KEY in .env.local and run 'make apply' from terraform/."
  }
}

variable "agentmail_email_address" {
  description = "AgentMail inbox address for OpenSea OTP emails"
  type        = string

  validation {
    condition     = length(trimspace(var.agentmail_email_address)) > 0
    error_message = "agentmail_email_address must be non-empty. Set AGENTMAIL_EMAIL_ADDRESS in .env.local and run 'make apply' from terraform/."
  }
}

variable "artifact_registry_kms_key_id" {
  description = "Optional KMS key ID for Artifact Registry CMEK encryption. Format: projects/{project}/locations/{location}/keyRings/{keyRing}/cryptoKeys/{key}"
  type        = string
  default     = null
}
