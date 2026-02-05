# Cloud Run service for morning briefing

resource "google_cloud_run_v2_service" "morning_briefing" {
  name     = "morning-briefing"
  location = var.region
  project  = var.project_id

  template {
    service_account = google_service_account.cloudrun.email

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/morning-briefing/app:latest"

      resources {
        limits = {
          memory = "1Gi"
          cpu    = "1"
        }
      }

      # Environment variables from Secret Manager
      env {
        name = "TELEGRAM_BOT_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.telegram_bot_token.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "TELEGRAM_CHAT_ID"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.telegram_chat_id.secret_id
            version = "latest"
          }
        }
      }

      # Regular environment variables
      env {
        name  = "TIMEZONE"
        value = var.timezone
      }

      env {
        name  = "LOG_LEVEL"
        value = "info"
      }

      env {
        name  = "USE_MOCK_DATA"
        value = "false"
      }

      # GCS bucket for ICS calendar files
      env {
        name  = "GCS_BUCKET"
        value = google_storage_bucket.ics_files.name
      }

      # Puppeteer configuration
      env {
        name  = "PUPPETEER_EXECUTABLE_PATH"
        value = "/usr/bin/google-chrome-stable"
      }

      ports {
        container_port = 8080
      }

      startup_probe {
        http_get {
          path = "/health"
        }
        initial_delay_seconds = 10
        timeout_seconds       = 3
        period_seconds        = 10
        failure_threshold     = 3
      }

      liveness_probe {
        http_get {
          path = "/health"
        }
        initial_delay_seconds = 30
        timeout_seconds       = 3
        period_seconds        = 30
        failure_threshold     = 3
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }

    timeout = "300s"
  }

  # Don't route traffic until we have a real image
  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [
    google_project_service.apis,
    google_artifact_registry_repository.morning_briefing,
    google_secret_manager_secret_version.telegram_bot_token,
    google_secret_manager_secret_version.telegram_chat_id,
  ]

  lifecycle {
    ignore_changes = [
      # Ignore image changes - managed by GitHub Actions
      template[0].containers[0].image,
      # Ignore client info annotations
      client,
      client_version,
    ]
  }
}
