# The API's scheduled jobs (ADR-009 phase 8). Cloud Scheduler starts each with
# POST /v1/jobs/<name> and proves itself with a short-lived identity token of
# its own service account, so no secret is stored in a job.

locals {
  # Job name => five-field cron expression, in UTC. The schedules are the ones
  # the database's own scheduler runs today (kc_private.scheduled_jobs).
  jobs = {
    "dispatch-notification"     = "* * * * *"
    "whatsapp-sender"           = "* * * * *"
    "process-post-media"        = "* * * * *"
    "embed-worker"              = "*/2 * * * *"
    "match-rerank"              = "*/5 * * * *"
    "subscriptions-charger"     = "10 * * * *"
    "realtime-retention"        = "20 * * * *"
    "rotate-research-salt"      = "15 0 * * *"
    "purge-deleted-accounts"    = "30 3 * * *"
    "reconcile-storage-orphans" = "0 5 * * *"
  }
}

resource "google_cloud_scheduler_job" "api" {
  for_each = local.jobs

  name        = "kc-api-${var.environment}-${each.key}"
  description = "Starts the KC API job ${each.key}"
  region      = var.region
  schedule    = each.value
  time_zone   = "Etc/UTC"
  # Paused until the job's work is switched over from the database's scheduler.
  paused = var.jobs_paused

  # A run that fails is not retried: the next tick is the retry, and every job
  # takes up its work where the last run left it.
  retry_config {
    retry_count = 0
  }

  attempt_deadline = "60s"

  http_target {
    uri         = "${google_cloud_run_v2_service.api.uri}/v1/jobs/${each.key}"
    http_method = "POST"
    headers     = { "Content-Type" = "application/json" }
    body        = base64encode("{}")

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = local.jobs_audience
    }
  }

  depends_on = [google_project_service.enabled]
}
