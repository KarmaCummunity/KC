# The development environment: the smallest sizes, one instance, no Redis.
# The project's id and the billing account are given on the command line
# (README.md), so neither is written in the repository.

environment = "dev"

# Frankfurt: the region nearest the Supabase project the API talks to until
# the database moves (ADR-009 phase 10).
region = "europe-west3"

github_repository = "KarmaCummunity/KC"
deploy_branch     = "dev"

# The kc-dev Supabase project signs the access tokens (docs/SSOT/ENVIRONMENTS.md).
auth_issuer = "https://enbqriuxvvuontiwslun.supabase.co/auth/v1"

allowed_origins = ["https://dev.karma-community.pages.dev"]

# Secrets that hold a value. Add a name here only after its value was added in
# Secret Manager; the API cannot start with a reference to an empty secret.
mounted_secrets = []
