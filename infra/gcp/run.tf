# The API itself: one Cloud Run service that scales to zero.

locals {
  # The audience of the scheduler's identity tokens: a name both sides agree
  # on. The scheduler asks Google for a token for it, and the API accepts no other.
  jobs_audience = "kc-api-${var.environment}-jobs"

  # Plain settings. Secrets are mounted from Secret Manager below.
  api_env = merge(
    {
      KC_API_ENVIRONMENT = "production"
      KC_AUTH_ISSUER     = var.auth_issuer
      # Cloud Run's front end is the one proxy in front of the API; the entry it adds is the client's address.
      KC_API_TRUSTED_PROXY_HOPS = "1"
      KC_JOBS_OIDC_AUDIENCE     = local.jobs_audience
      KC_JOBS_SERVICE_ACCOUNT   = google_service_account.scheduler.email
    },
    length(var.allowed_origins) > 0 ? { KC_API_ALLOWED_ORIGINS = join(",", var.allowed_origins) } : {},
    # Without Redis the API must be told it is the only instance; it refuses to start otherwise.
    var.redis_url_secret ? {} : { KC_API_SINGLE_INSTANCE = "1" },
    var.media_public_url == null ? {} : {
      KC_STORAGE_GCS_BUCKET_PREFIX = local.bucket_prefix
      KC_MEDIA_PUBLIC_URL          = var.media_public_url
    },
  )
}

resource "google_cloud_run_v2_service" "api" {
  name     = "kc-api-${var.environment}"
  location = var.region
  # The mobile app and the web app call the API from the internet.
  ingress = "INGRESS_TRAFFIC_ALL"

  # An environment is removed on purpose, in two steps, never by a stray `destroy`.
  deletion_protection = true

  template {
    service_account = google_service_account.api.email
    timeout         = "60s"

    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }

    containers {
      # A placeholder that answers on the port. The deploy workflow replaces
      # it with the built image; Terraform then leaves the image alone (below).
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        # Billed only while a request is being served.
        cpu_idle = true
      }

      dynamic "env" {
        for_each = local.api_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.mounted_secret_env
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.api[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      # Traffic reaches a new instance only once the process answers.
      startup_probe {
        http_get {
          path = "/health"
        }
        period_seconds    = 2
        timeout_seconds   = 2
        failure_threshold = 30
      }
    }
  }

  lifecycle {
    # Which image runs is the deploy workflow's decision, not this file's.
    ignore_changes = [template[0].containers[0].image, client, client_version]

    precondition {
      condition     = var.redis_url_secret || var.max_instances == 1
      error_message = "Without Redis the API keeps its rate counters and realtime members in one process: max_instances must be 1 (or set redis_url_secret = true)."
    }

    precondition {
      condition     = length(setsubtract(var.mounted_secrets, local.secret_env)) == 0
      error_message = "mounted_secrets names a variable that is not one of the API's secrets (local.secret_env in secrets.tf)."
    }
  }

  depends_on = [
    google_secret_manager_secret_iam_member.api_reads,
    google_artifact_registry_repository_iam_member.api_pulls_images,
  ]
}

# Anyone may reach the API; it decides who a caller is from their access token.
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.api.name
  location = google_cloud_run_v2_service.api.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# The deploy workflow rolls out new revisions of this one service.
resource "google_cloud_run_v2_service_iam_member" "deployer_deploys" {
  name     = google_cloud_run_v2_service.api.name
  location = google_cloud_run_v2_service.api.location
  role     = "roles/run.developer"
  member   = google_service_account.deployer.member
}
