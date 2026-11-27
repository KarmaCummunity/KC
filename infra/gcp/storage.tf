# KC's file buckets (ADR-012). A KC bucket keeps its name behind a prefix per
# environment, because cloud bucket names are unique among all customers.

locals {
  # The buckets of storage.buckets, the API's index of its files.
  kc_buckets = toset(["avatars", "post-images", "chat-media"])
  # A project's id is already unique among all customers, so it makes the names unique.
  bucket_prefix = coalesce(var.bucket_prefix, "${var.project_id}-")
}

resource "google_storage_bucket" "kc" {
  for_each = local.kc_buckets

  name     = "${local.bucket_prefix}${each.value}"
  location = var.region

  # Access is by IAM only, never by per-object lists.
  uniform_bucket_level_access = true
  # Nothing here is readable from the internet directly: public files are
  # served through KC's media address, private ones through signed addresses.
  public_access_prevention = "enforced"

  # A browser uploads straight to a signed address and reads a signed one back.
  dynamic "cors" {
    for_each = length(var.allowed_origins) > 0 ? [1] : []
    content {
      origin          = var.allowed_origins
      method          = ["GET", "HEAD", "PUT"]
      response_header = ["Content-Type", "Cache-Control", "x-goog-if-generation-match", "x-goog-content-length-range"]
      max_age_seconds = 3600
    }
  }

  depends_on = [google_project_service.enabled]
}

# The API stores, reads, lists and removes objects; it cannot change a bucket.
resource "google_storage_bucket_iam_member" "api_objects" {
  for_each = local.kc_buckets

  bucket = google_storage_bucket.kc[each.value].name
  role   = "roles/storage.objectUser"
  member = google_service_account.api.member
}
