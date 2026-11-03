#!/usr/bin/env bash
# Runs every DB test against the LOCAL Supabase stack (G38). Used by CI — backend and
# by agents locally, so both run exactly the same suite in the same order:
#   1. install the shared harness (supabase/tests/_harness/*.sql, lexical order)
#   2. per-migration regression tests (supabase/tests/*.sql)
#   3. per-world lifecycle flow tests (supabase/tests/flows/*.sql)
#
# Usage: scripts/run-db-tests.sh [file.sql ...]   (no args = the full suite)
# Env:   DB_URL — connection URI; when unset it is read from `supabase status`, so no
#        credential ever lives in this repository.
set -euo pipefail
shopt -s nullglob

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly TESTS_DIR="$ROOT/supabase/tests"

if [[ -z "${DB_URL:-}" ]]; then
  DB_URL="$(supabase status -o env | sed -n 's/^DB_URL="\(.*\)"$/\1/p')"
fi
if [[ -z "$DB_URL" ]]; then
  echo "run-db-tests: no DB_URL and no running local stack (run 'supabase start')" >&2
  exit 2
fi

# The harness creates a schema and the tests write rows: refuse anything but a local stack.
db_host="$(sed -E 's#^[a-z]+://([^@/]*@)?(\[[^]]*\]|[^:/?]+).*#\2#' <<<"$DB_URL")"
case "$db_host" in
  127.0.0.1 | localhost | "[::1]") ;;
  *)
    echo "run-db-tests: refusing to run against non-local host '$db_host'" >&2
    exit 2
    ;;
esac

run_sql() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$1"
}

echo "── Installing test harness ──"
for f in "$TESTS_DIR"/_harness/*.sql; do
  run_sql "$f"
done

if (($# > 0)); then
  files=("$@")
else
  files=("$TESTS_DIR"/*.sql "$TESTS_DIR"/flows/*.sql)
fi

for f in "${files[@]}"; do
  echo "── Running ${f#"$ROOT"/} ──"
  run_sql "$f"
done

echo "✓ ${#files[@]} DB test file(s) passed"
