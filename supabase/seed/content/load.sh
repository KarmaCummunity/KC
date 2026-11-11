#!/usr/bin/env bash
# Loads the content seed (organization links, legal texts, surveys, the platform organization)
# into one database. Same script for kc-prod, kc-dev and a local stack; safe to run again.
#
# Usage: CONTENT_DB_URL=<connection URI> supabase/seed/content/load.sh
#   Run supabase/seed/reference/load.sh first. The URI must connect as a role that owns the
#   tables and is exempt from row level security (`postgres` on a Supabase project). It is
#   read from the environment only, so no credential is ever written to this repository.
set -euo pipefail

: "${CONTENT_DB_URL:?set CONTENT_DB_URL to the target database connection URI}"
cd "$(dirname "${BASH_SOURCE[0]}")"
psql "$CONTENT_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f load.sql
