#!/usr/bin/env bash
set -euo pipefail

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_env_value() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    echo "Could not read $name from 'supabase status -o env'." >&2
    exit 1
  fi
}

require_command docker
require_command supabase
require_command node

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop and retry." >&2
  exit 1
fi

# A branch carries `next-NN_slug.sql` files; the real number is assigned on merge. Number them for
# this run so the stack applies them, and put the names back on exit so no rename gets committed.
node "$(dirname "$0")/migration-ids.mjs" assign
trap 'node "$(dirname "$0")/migration-ids.mjs" restore' EXIT

echo "Starting local Supabase..."
supabase start

echo "Resetting local database..."
supabase db reset

echo "Reading local Supabase credentials..."
status_env="$(supabase status -o env)"

set -a
eval "$status_env"
set +a

SUPABASE_URL="${API_URL:-}"
SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-}"

require_env_value SUPABASE_URL
require_env_value SUPABASE_SERVICE_ROLE_KEY
require_env_value ANON_KEY

export SUPABASE_URL
export SUPABASE_SERVICE_ROLE_KEY

cat <<EOF

Local KC database is ready (migrations + seed.sql applied).

Add this to app/.env.local:

EXPO_PUBLIC_SUPABASE_URL=${SUPABASE_URL}
EXPO_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}

Run the mobile app: cd app && pnpm mobile
Run web export preview: cd app && pnpm build:web && pnpm preview:web

Never commit app/.env.local or service-role keys.
See CONTRIBUTING.md for the full contributor checklist.
EOF
