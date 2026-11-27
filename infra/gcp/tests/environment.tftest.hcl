# What this configuration promises, checked without a cloud account: the
# provider is replaced by a mock, so nothing is created and no credential is
# needed. Run with `terraform test` from infra/gcp.

mock_provider "google" {
  mock_data "google_project" {
    defaults = {
      number = "123456789012"
    }
  }

  # The provider checks the shape of what it is given, so the values a real
  # project would compute are given in that shape instead of at random.
  mock_resource "google_service_account" {
    defaults = {
      name   = "projects/kc-test/serviceAccounts/mock@kc-test.iam.gserviceaccount.com"
      email  = "mock@kc-test.iam.gserviceaccount.com"
      member = "serviceAccount:mock@kc-test.iam.gserviceaccount.com"
    }
  }

  mock_resource "google_iam_workload_identity_pool" {
    defaults = {
      name = "projects/123456789012/locations/global/workloadIdentityPools/github-dev"
    }
  }

  mock_resource "google_cloud_run_v2_service" {
    defaults = {
      uri = "https://kc-api-dev-123456789012.europe-west3.run.app"
    }
  }
}

variables {
  project_id        = "kc-test"
  environment       = "dev"
  region            = "europe-west3"
  github_repository = "KarmaCummunity/KC"
  deploy_branch     = "dev"
  auth_issuer       = "https://auth.example.test/auth/v1"
}

run "smallest_environment" {
  command = apply

  assert {
    condition     = google_cloud_run_v2_service.api.template[0].scaling[0].min_instance_count == 0 && google_cloud_run_v2_service.api.template[0].scaling[0].max_instance_count == 1
    error_message = "The smallest environment scales to zero and never past one instance."
  }

  assert {
    condition     = local.api_env.KC_API_SINGLE_INSTANCE == "1" && !contains(local.mounted_secret_env, "REDIS_URL")
    error_message = "Without Redis the API is declared a single instance and is given no Redis address."
  }

  assert {
    condition     = !contains(keys(local.api_env), "KC_STORAGE_GCS_BUCKET_PREFIX") && !contains(keys(local.api_env), "KC_MEDIA_PUBLIC_URL")
    error_message = "Without a media address the API is deployed without a file store."
  }

  assert {
    condition     = length(google_cloud_scheduler_job.api) == 10 && alltrue([for job in google_cloud_scheduler_job.api : job.paused])
    error_message = "All ten jobs exist and are paused until their work is switched over."
  }

  assert {
    condition     = alltrue([for name, job in google_cloud_scheduler_job.api : endswith(job.http_target[0].uri, "/v1/jobs/${name}") && job.http_target[0].http_method == "POST"])
    error_message = "Each job starts its own route of the API."
  }

  assert {
    condition     = alltrue([for job in google_cloud_scheduler_job.api : job.http_target[0].oidc_token[0].audience == local.api_env.KC_JOBS_OIDC_AUDIENCE && job.http_target[0].oidc_token[0].service_account_email == local.api_env.KC_JOBS_SERVICE_ACCOUNT])
    error_message = "The scheduler proves itself with exactly the identity and audience the API is told to accept."
  }

  assert {
    condition     = alltrue([for bucket in google_storage_bucket.kc : bucket.public_access_prevention == "enforced" && bucket.uniform_bucket_level_access])
    error_message = "No bucket is readable from the internet directly."
  }

  assert {
    condition     = toset([for bucket in google_storage_bucket.kc : bucket.name]) == toset(["kc-test-avatars", "kc-test-post-images", "kc-test-chat-media"])
    error_message = "A KC bucket keeps its name behind the project's id."
  }

  assert {
    condition     = length(google_billing_budget.monthly) == 0
    error_message = "No budget is created without a billing account."
  }

  assert {
    condition     = strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "assertion.repository == \"KarmaCummunity/KC\"") && strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "assertion.ref == \"refs/heads/dev\"")
    error_message = "Only this repository's deploy branch can get credentials."
  }
}

run "with_files_redis_and_secrets" {
  command = apply

  variables {
    media_public_url = "https://media.example.test"
    redis_url_secret = true
    max_instances    = 3
    mounted_secrets  = ["DATABASE_URL", "GEMINI_API_KEY"]
    allowed_origins  = ["https://app.example.test"]
  }

  assert {
    condition     = local.api_env.KC_STORAGE_GCS_BUCKET_PREFIX == "kc-test-" && local.api_env.KC_MEDIA_PUBLIC_URL == "https://media.example.test"
    error_message = "With a media address the API is given its file store."
  }

  assert {
    condition     = !contains(keys(local.api_env), "KC_API_SINGLE_INSTANCE") && local.mounted_secret_env == toset(["DATABASE_URL", "GEMINI_API_KEY", "REDIS_URL"])
    error_message = "With Redis the API is not declared a single instance, and it is started with the Redis address and the declared secrets."
  }

  assert {
    condition     = google_storage_bucket.kc["avatars"].cors[0].origin == tolist(["https://app.example.test"])
    error_message = "A browser of an allowed origin may upload to a signed address."
  }
}

run "refuses_several_instances_without_redis" {
  command = plan

  variables {
    max_instances = 2
  }

  expect_failures = [google_cloud_run_v2_service.api]
}

run "refuses_a_mounted_secret_the_api_does_not_have" {
  command = plan

  variables {
    mounted_secrets = ["NOT_A_SECRET_OF_THE_API"]
  }

  expect_failures = [google_cloud_run_v2_service.api]
}

run "refuses_a_budget_without_an_amount" {
  command = plan

  variables {
    billing_account_id = "000000-AAAAAA-000000"
  }

  expect_failures = [var.monthly_budget]
}

run "sets_the_budget_in_the_account_currency" {
  command = apply

  variables {
    billing_account_id = "000000-AAAAAA-000000"
    monthly_budget     = { currency_code = "ILS", units = 100 }
  }

  assert {
    condition     = google_billing_budget.monthly[0].amount[0].specified_amount[0].currency_code == "ILS" && google_billing_budget.monthly[0].amount[0].specified_amount[0].units == "100"
    error_message = "The budget is the agreed amount in the billing account's currency."
  }
}
