# Secret Manager secrets for Telegram credentials

resource "google_secret_manager_secret" "telegram_bot_token" {
  secret_id = "telegram-bot-token"
  project   = var.project_id

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "telegram_bot_token" {
  secret      = google_secret_manager_secret.telegram_bot_token.id
  secret_data = var.telegram_bot_token
}

resource "google_secret_manager_secret" "telegram_chat_id" {
  secret_id = "telegram-chat-id"
  project   = var.project_id

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "telegram_chat_id" {
  secret      = google_secret_manager_secret.telegram_chat_id.id
  secret_data = var.telegram_chat_id
}

resource "google_secret_manager_secret" "agentmail_api_key" {
  secret_id = "agentmail-api-key"
  project   = var.project_id

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "agentmail_api_key" {
  secret      = google_secret_manager_secret.agentmail_api_key.id
  secret_data = var.agentmail_api_key
}

# Grant Cloud Run service account access to secrets
resource "google_secret_manager_secret_iam_member" "cloudrun_bot_token" {
  secret_id = google_secret_manager_secret.telegram_bot_token.secret_id
  project   = var.project_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}

resource "google_secret_manager_secret_iam_member" "cloudrun_chat_id" {
  secret_id = google_secret_manager_secret.telegram_chat_id.secret_id
  project   = var.project_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}

resource "google_secret_manager_secret_iam_member" "cloudrun_agentmail_api_key" {
  secret_id = google_secret_manager_secret.agentmail_api_key.secret_id
  project   = var.project_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}
