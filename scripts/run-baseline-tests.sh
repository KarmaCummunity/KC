#!/usr/bin/env bash
# Builds a scratch database from the production baseline and runs its pgTAP tests.
#
#   1. create an empty database on a LOCAL PostgreSQL server
#   2. apply the Supabase shim (roles, `auth`, `extensions` — what the platform provides)
#   3. apply supabase/baseline/0001_baseline.sql
#   4. run every supabase/baseline/tests/*.sql and fail on any `not ok`
#
# The scratch database is dropped and recreated on every run, so the baseline is always
# proven against an empty database — the state production starts from.
#
# Usage: scripts/run-baseline-tests.sh [test.sql ...]   (no args = every test)
# Env:   DB_URL — admin connection URI to a local server; when unset it is read from
#        `supabase status`, so no credential ever lives in this repository.
set -euo pipefail
shopt -s nullglob

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly BASELINE="$ROOT/supabase/baseline/0001_baseline.sql"
readonly SHIM="$ROOT/supabase/baseline/local/supabase_shim.sql"
readonly TESTS_DIR="$ROOT/supabase/baseline/tests"
readonly SCRATCH_DB="kc_baseline_check"

if [[ -z "${DB_URL:-}" ]]; then
  DB_URL="$(supabase status -o env | sed -n 's/^DB_URL="\(.*\)"$/\1/p')"
fi
if [[ -z "$DB_URL" ]]; then
  echo "run-baseline-tests: no DB_URL and no running local stack" >&2
  exit 2
fi

# Dropping and creating a database is destructive: refuse anything but a local server.
# The server itself reports its address; NULL means a Unix-domain socket.
server_addr="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -Atc "select coalesce(host(inet_server_addr()), 'socket')")"
case "$server_addr" in
  socket | 127.* | ::1 | 172.* | 192.168.* | 10.*) ;;
  *)
    echo "run-baseline-tests: refusing to run against non-local server '$server_addr'" >&2
    exit 2
    ;;
esac

# Connection URI of the scratch database: the same server, another database name.
scratch_url() {
  node -e '
    const url = new URL(process.argv[1]);
    url.pathname = "/" + process.argv[2];
    process.stdout.write(url.toString());
  ' "$DB_URL" "$SCRATCH_DB"
}

echo "── Creating empty database $SCRATCH_DB ──"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q \
  -c "drop database if exists $SCRATCH_DB with (force)" \
  -c "create database $SCRATCH_DB"
readonly SCRATCH_URL="$(scratch_url)"

run_sql() {
  psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -q -f "$1"
}

echo "── Applying Supabase shim ──"
run_sql "$SHIM"

echo "── Applying baseline ──"
# One transaction, as a migration runner applies it: a failing statement leaves nothing behind.
psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -q --single-transaction -f "$BASELINE"

if (($# > 0)); then
  files=("$@")
else
  files=("$TESTS_DIR"/*.sql)
fi

failed=0
for f in "${files[@]}"; do
  echo "── $(basename "$f") ──"
  # pgTAP reports a failed assertion as a `not ok` row and a wrong test count as a
  # `# Looks like` diagnostic; neither is a SQL error, so both are checked here.
  output="$(psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -qAt -f "$f")"
  echo "$output"
  if grep -Eq '^(not ok|# Looks like)' <<<"$output"; then
    failed=1
  fi
done

if ((failed)); then
  echo "run-baseline-tests: FAILED" >&2
  exit 1
fi
echo "run-baseline-tests: all baseline tests passed"
