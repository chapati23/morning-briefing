# Cloud Scheduler job to trigger daily briefing

resource "google_cloud_scheduler_job" "morning_briefing" {
  name        = "morning-briefing-trigger"
  description = "Triggers the morning briefing daily"
  schedule    = var.schedule_cron
  time_zone   = var.timezone
  project     = var.project_id
  region      = var.region

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.morning_briefing.uri}/briefing"

    oidc_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  retry_config {
    retry_count          = 3
    min_backoff_duration = "5s"
    max_backoff_duration = "300s"
    max_retry_duration   = "0s" # No limit
    max_doublings        = 5
  }

  depends_on = [
    google_project_service.apis,
    google_cloud_run_v2_service.morning_briefing,
  ]
}
