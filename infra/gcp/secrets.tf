# The API's secrets, as empty containers: a person adds each value in Secret
# Manager (README.md), so no value is ever in this repository, in a variable
# file or in the Terraform state.

locals {
  # Every secret environment variable of the API (app/apps/api/README.md).
  # The secret's own name is the variable's, lower-cased with dashes.
  secret_env = toset([
    "DATABASE_URL",
    "REDIS_URL",
    "KC_JOBS_TOKEN",
    "EXPO_ACCESS_TOKEN",
    "GEMINI_API_KEY",
    "IDV_PROVIDER_API_KEY",
    "IDV_DIDIT_WORKFLOW_ID",
    "IDV_WEBHOOK_SECRET",
    "IDV_IDENTITY_HASH_KEY",
    "KC_STORAGE_COPY_SOURCE_KEY",
    "REVENUECAT_WEBHOOK_AUTH",
    "WHATSAPP_CLOUD_API_TOKEN",
    "WHATSAPP_VERIFY_TOKEN",
    "WHATSAPP_APP_SECRET",
  ])

  # What the API is started with: the secrets declared to hold a value, and
  # the Redis address when the environment has Redis.
  mounted_secret_env = setunion(var.mounted_secrets, var.redis_url_secret ? ["REDIS_URL"] : [])
}

resource "google_secret_manager_secret" "api" {
  for_each = local.secret_env

  secret_id = "kc-api-${var.environment}-${lower(replace(each.value, "_", "-"))}"

  replication {
    auto {}
  }

  depends_on = [google_project_service.enabled]
}

# The API may read its own secrets and nothing else.
resource "google_secret_manager_secret_iam_member" "api_reads" {
  for_each = local.secret_env

  secret_id = google_secret_manager_secret.api[each.value].id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.api.member
}
