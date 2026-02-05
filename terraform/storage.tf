# Cloud Storage bucket for ICS calendar files
# These files are served directly via GCS CDN for instant downloads

# trunk-ignore(checkov/CKV_GCP_114): Public access is intentional - ICS files must be downloadable via URL
# trunk-ignore(checkov/CKV_GCP_62): Access logging adds complexity without benefit for public calendar files
resource "google_storage_bucket" "ics_files" {
  name     = "morning-briefing-ics-${var.project_id}"
  location = var.region
  project  = var.project_id

  # Use uniform bucket-level access (recommended over ACLs)
  uniform_bucket_level_access = true

  # Enable versioning for recovery
  versioning {
    enabled = true
  }

  # Lifecycle rule to delete old ICS files after 7 days
  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "Delete"
    }
  }

  # CORS configuration for browser downloads
  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type", "Content-Disposition"]
    max_age_seconds = 3600
  }

  depends_on = [google_project_service.apis]
}

# Make bucket publicly readable for ICS file downloads
# trunk-ignore(checkov/CKV_GCP_28): Public access is intentional - ICS calendar URLs must be shareable
resource "google_storage_bucket_iam_member" "ics_public_read" {
  bucket = google_storage_bucket.ics_files.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# Allow Cloud Run service account to write ICS files
resource "google_storage_bucket_iam_member" "cloudrun_write" {
  bucket = google_storage_bucket.ics_files.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.cloudrun.email}"
}
