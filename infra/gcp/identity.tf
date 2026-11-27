# Who acts in this environment. Three service accounts, each with only what
# its one job needs, and no key file for any of them.

# The API itself.
resource "google_service_account" "api" {
  account_id   = "kc-api-${var.environment}"
  display_name = "KC API (${var.environment})"

  depends_on = [google_project_service.enabled]
}

# The API signs storage addresses as itself, through the IAM credentials
# service, instead of holding a private key (ADR-012).
resource "google_service_account_iam_member" "api_signs_as_itself" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = google_service_account.api.member
}

# Cloud Scheduler calls the API as this account. It has no role anywhere: the
# API checks that a job's caller is exactly this account (KC_JOBS_SERVICE_ACCOUNT).
resource "google_service_account" "scheduler" {
  account_id   = "kc-scheduler-${var.environment}"
  display_name = "KC scheduled jobs (${var.environment})"

  depends_on = [google_project_service.enabled]
}

# The deploy workflow on GitHub acts as this account.
resource "google_service_account" "deployer" {
  account_id   = "kc-deployer-${var.environment}"
  display_name = "KC deploy workflow (${var.environment})"

  depends_on = [google_project_service.enabled]
}

# A new revision runs as the API's account, so whoever deploys one must be allowed to use it.
resource "google_service_account_iam_member" "deployer_uses_api_account" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.deployer.member
}

# --- Workload Identity Federation: GitHub Actions without a stored key -------

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-${var.environment}"
  display_name              = "GitHub Actions (${var.environment})"

  depends_on = [google_project_service.enabled]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub Actions"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # GitHub signs tokens for every repository on github.com. Only runs of this
  # repository, on its deploy branch, are accepted at all.
  attribute_condition = "assertion.repository == \"${var.github_repository}\" && assertion.ref == \"refs/heads/${var.deploy_branch}\""
}

resource "google_service_account_iam_member" "github_acts_as_deployer" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}
