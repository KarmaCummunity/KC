# The services this environment uses. Enabling one is free; `disable_on_destroy`
# is off so that removing this configuration never switches off an API
# something else in the project came to depend on.

locals {
  services = [
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "iam.googleapis.com",
    # Signs storage addresses and mints the scheduler's identity tokens.
    "iamcredentials.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
    # Exchanges a GitHub workflow's token for Google credentials.
    "sts.googleapis.com",
  ]
}

resource "google_project_service" "enabled" {
  for_each = toset(local.services)

  service            = each.value
  disable_on_destroy = false
}
