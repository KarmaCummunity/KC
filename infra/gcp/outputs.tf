output "api_url" {
  description = "Where the API answers."
  value       = google_cloud_run_v2_service.api.uri
}

output "image_repository" {
  description = "Where the deploy workflow pushes the API's images."
  value       = "${google_artifact_registry_repository.images.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "workload_identity_provider" {
  description = "The provider a GitHub workflow names to get Google credentials (repository variable GCP_WORKLOAD_IDENTITY_PROVIDER)."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_service_account" {
  description = "The account the deploy workflow acts as (repository variable GCP_DEPLOYER_SERVICE_ACCOUNT)."
  value       = google_service_account.deployer.email
}

output "api_service_account" {
  description = "The account the API runs as."
  value       = google_service_account.api.email
}

output "bucket_prefix" {
  description = "What precedes a KC bucket's name in its cloud bucket's name."
  value       = local.bucket_prefix
}

output "secret_names" {
  description = "Secret Manager name of each of the API's secret variables; a person adds the values."
  value       = { for name, secret in google_secret_manager_secret.api : name => secret.secret_id }
}
