# Where the API's container images are kept.

resource "google_artifact_registry_repository" "images" {
  repository_id = "kc-${var.environment}"
  location      = var.region
  format        = "DOCKER"
  description   = "Container images of the KC API (${var.environment})"

  # Every merge builds an image. Keep the recent ones, which is what a
  # rollback needs, and let the rest go so storage does not grow for ever.
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 15
    }
  }
  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "30d"
    }
  }

  depends_on = [google_project_service.enabled]
}

resource "google_artifact_registry_repository_iam_member" "deployer_pushes_images" {
  repository = google_artifact_registry_repository.images.name
  location   = google_artifact_registry_repository.images.location
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.deployer.member
}

resource "google_artifact_registry_repository_iam_member" "api_pulls_images" {
  repository = google_artifact_registry_repository.images.name
  location   = google_artifact_registry_repository.images.location
  role       = "roles/artifactregistry.reader"
  member     = google_service_account.api.member
}
