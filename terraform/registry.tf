# Artifact Registry repository for Docker images
#
# checkov:skip=CKV_GCP_84: CMEK encryption adds cost and complexity.
# For production with compliance requirements, set var.artifact_registry_kms_key_id
resource "google_artifact_registry_repository" "morning_briefing" {
  location      = var.region
  repository_id = "morning-briefing"
  description   = "Docker images for morning-briefing service"
  format        = "DOCKER"
  project       = var.project_id
  kms_key_name  = var.artifact_registry_kms_key_id

  depends_on = [google_project_service.apis]
}
