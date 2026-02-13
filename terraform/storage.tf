# GCS bucket for persistent data (e.g., App Store ranking history)
resource "google_storage_bucket" "data" {
  # checkov:skip=CKV_GCP_62: Access logging not needed for internal data bucket with only JSON files
  name     = "${var.project_id}-briefing-data"
  location = var.region
  project  = var.project_id

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  # Safety net: delete objects if the cron stops running and they go stale.
  # During normal operation this never fires because the file is overwritten daily
  # (which resets the object age).
  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age = 365
    }
  }

  # With versioning enabled, old versions accumulate on every daily write.
  # Delete non-current versions after 7 days to avoid unbounded growth.
  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      num_newer_versions = 7
      with_state         = "ARCHIVED"
    }
  }

  depends_on = [google_project_service.apis]
}
