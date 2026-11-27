# The KC API's Google Cloud environment (ADR-009 phase 2). One root module,
# applied once per environment with that environment's variable file and its
# own state prefix (README.md).

terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.12"
    }
  }

  # The bucket and prefix are given at `terraform init` (README.md), so no
  # project's name is written here.
  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region

  # The budget API bills and checks quota against a project of the caller's
  # choice; without these two it has none when run with a person's own login.
  billing_project       = var.project_id
  user_project_override = true
}

data "google_project" "this" {
  project_id = var.project_id
}
