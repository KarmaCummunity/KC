#!/usr/bin/env bash
# Builds the throwaway database the API's KC-schema suites run on: an empty
# database, the whole migration chain, and the reference seed (cities, …).
#
# Needs a LOCAL PostgreSQL 17 with PostGIS, pgvector and pgTAP, and no Docker:
# the chain applies on plain Postgres through the Supabase shim
# (scripts/run-baseline-tests.sh, which also refuses any non-local server).
#
# Usage:  DB_URL=postgres://postgres@127.0.0.1:5432/postgres apps/api/scripts/kc-test-db.sh
# Prints: the KC_API_TEST_KC_DATABASE_URL line to export before `pnpm --filter @kc/api test`.
# Env:    KC_API_TEST_DB — database name (default kc_api_test).
set -euo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
readonly SCRATCH_DB="${KC_API_TEST_DB:-kc_api_test}"
: "${DB_URL:?set DB_URL to the admin connection URI of a local PostgreSQL 17}"

# Notices (optional extensions that are absent locally) are noise here; errors still show.
export PGOPTIONS="-c client_min_messages=warning"

# One baseline test is enough to make the runner build the database.
BASELINE_SCRATCH_DB="$SCRATCH_DB" "$ROOT/scripts/run-baseline-tests.sh" "$ROOT/supabase/tests/001_foundation.sql" >/dev/null

scratch_url="$(node -e '
  const url = new URL(process.argv[1]);
  url.pathname = "/" + process.argv[2];
  process.stdout.write(url.toString());
' "$DB_URL" "$SCRATCH_DB")"

(cd "$ROOT/supabase/seed/reference" && psql "$scratch_url" -v ON_ERROR_STOP=1 --single-transaction -qAt -f load.sql >/dev/null)

echo "KC_API_TEST_KC_DATABASE_URL=$scratch_url"
