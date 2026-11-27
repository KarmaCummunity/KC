variable "project_id" {
  description = "The Google Cloud project this environment lives in."
  type        = string
}

variable "environment" {
  description = "Short name of the environment; part of resource names and of the bucket prefix."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9]{1,9}$", var.environment))
    error_message = "Use 2 to 10 lowercase letters and digits, starting with a letter (for example: dev)."
  }
}

variable "region" {
  description = "Region of every regional resource. Until the database moves (ADR-009 phase 10) this is the region nearest the Supabase project the API talks to."
  type        = string
}

variable "github_repository" {
  description = "The GitHub repository whose deploy workflow may deploy here, as owner/name."
  type        = string
}

variable "deploy_branch" {
  description = "The only branch of that repository whose workflow runs may deploy here."
  type        = string
}

variable "auth_issuer" {
  description = "Issuer of the access tokens the API accepts (KC_AUTH_ISSUER)."
  type        = string
}

variable "allowed_origins" {
  description = "Web origins that may call the API and upload to its buckets from a browser (KC_API_ALLOWED_ORIGINS)."
  type        = list(string)
  default     = []
}

variable "media_public_url" {
  description = "KC's media address, which serves the public buckets. Null: the API is deployed without a file store and its storage routes answer 503."
  type        = string
  default     = null
}

variable "storage_copy_source_url" {
  description = "The Supabase project KC's existing files are copied from (KC_STORAGE_COPY_SOURCE_URL), for the time the files are being moved (ADR-012). Needs KC_STORAGE_COPY_SOURCE_KEY in mounted_secrets. Null: the API copies none."
  type        = string
  default     = null
}

variable "bucket_prefix" {
  description = "What precedes a KC bucket's name in its cloud bucket's name (KC_STORAGE_GCS_BUCKET_PREFIX). Null: the project's id and a dash."
  type        = string
  default     = null
}

variable "redis_url_secret" {
  description = "Whether the API reads REDIS_URL from its secret. False: the API runs as a declared single instance without Redis, and the service is capped at one instance."
  type        = bool
  default     = false
}

variable "max_instances" {
  description = "Most instances of the API. Must be 1 while the API runs without Redis."
  type        = number
  default     = 1

  validation {
    condition     = var.max_instances >= 1 && var.max_instances <= 20
    error_message = "Between 1 and 20."
  }
}

variable "mounted_secrets" {
  description = "Names of the secret environment variables the API is started with. Each must already hold a value in Secret Manager: a service that references an empty secret cannot start. Every name must be one of local.secret_env (secrets.tf)."
  type        = set(string)
  default     = []
}

variable "jobs_paused" {
  description = "Whether the scheduled jobs are paused. True until a job's work is switched over from the database's own scheduler; two schedulers would do the work twice."
  type        = bool
  default     = true
}

variable "billing_account_id" {
  description = "The billing account the budget alert is set on. Null: no budget is created (the person applying needs the right to manage budgets on the account)."
  type        = string
  default     = null
}

variable "monthly_budget" {
  description = "The monthly amount the budget alerts on, in the billing account's own currency."
  type = object({
    currency_code = string
    units         = number
  })
  default = null

  validation {
    condition     = var.billing_account_id == null || var.monthly_budget != null
    error_message = "Set monthly_budget (currency_code and units) together with billing_account_id."
  }
}
