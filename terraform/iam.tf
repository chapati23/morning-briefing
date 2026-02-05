# Service account for Cloud Run
resource "google_service_account" "cloudrun" {
  account_id   = "morning-briefing-run"
  display_name = "Morning Briefing Cloud Run Service Account"
  project      = var.project_id

  depends_on = [google_project_service.apis]
}

# Service account for Cloud Scheduler to invoke Cloud Run
resource "google_service_account" "scheduler" {
  account_id   = "morning-briefing-scheduler"
  display_name = "Morning Briefing Scheduler Service Account"
  project      = var.project_id

  depends_on = [google_project_service.apis]
}

# Allow scheduler service account to invoke Cloud Run
resource "google_cloud_run_v2_service_iam_member" "scheduler_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.morning_briefing.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

# Service account for GitHub Actions deployments
resource "google_service_account" "github_actions" {
  account_id   = "github-actions-deploy"
  display_name = "GitHub Actions Deploy Service Account"
  project      = var.project_id

  depends_on = [google_project_service.apis]
}

# Grant GitHub Actions SA permissions to push to Artifact Registry
resource "google_artifact_registry_repository_iam_member" "github_actions_writer" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.morning_briefing.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.github_actions.email}"
}

# Grant GitHub Actions SA permissions to deploy to Cloud Run
resource "google_project_iam_member" "github_actions_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

# Grant GitHub Actions SA permission to act as the Cloud Run service account
resource "google_service_account_iam_member" "github_actions_act_as_cloudrun" {
  service_account_id = google_service_account.cloudrun.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.github_actions.email}"
}
