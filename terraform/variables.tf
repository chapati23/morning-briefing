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


variable "artifact_registry_kms_key_id" {
  description = "Optional KMS key ID for Artifact Registry CMEK encryption. Format: projects/{project}/locations/{location}/keyRings/{keyRing}/cryptoKeys/{key}"
  type        = string
  default     = null
}
