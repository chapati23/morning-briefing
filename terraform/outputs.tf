output "service_url" {
  description = "URL of the Cloud Run service"
  value       = google_cloud_run_v2_service.morning_briefing.uri
}

output "workload_identity_provider" {
  description = "Workload Identity Provider for GitHub Actions (use in WIF_PROVIDER secret)"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "service_account_email" {
  description = "Service account email for GitHub Actions (use in WIF_SERVICE_ACCOUNT secret)"
  value       = google_service_account.github_actions.email
}

output "artifact_registry_url" {
  description = "Artifact Registry URL for Docker images"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/morning-briefing"
}

output "scheduler_job_name" {
  description = "Name of the Cloud Scheduler job"
  value       = google_cloud_scheduler_job.morning_briefing.name
}

output "project_id" {
  description = "GCP Project ID"
  value       = var.project_id
}

output "region" {
  description = "GCP Region"
  value       = var.region
}
