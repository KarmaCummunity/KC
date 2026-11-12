#!/usr/bin/env bash
# One-time extraction of the reference rows from the incremental migration chain into the CSV
# files under data/. The rows existed only as INSERT / UPDATE statements inside migrations;
# this script replays exactly those statements into a throwaway database on a LOCAL PostgreSQL
# server (PostGIS required) and exports the result, sorted, so the files are stable.
#
#   cities    0008 (names) + 0023, 0024, 0089 (coordinates, applied in that order)
#   streets   0101
#   junctions 0513 (Israel TM Grid converted to WGS84 by PostGIS, as the migration does)
#
# Usage: DB_URL=postgresql://postgres@127.0.0.1:5432/postgres supabase/seed/reference/extract-from-migrations.sh
set -euo pipefail

readonly HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly MIGRATIONS="$HERE/../../migrations/archive"
readonly SCRATCH_DB="kc_reference_extract"
: "${DB_URL:?set DB_URL to an admin connection URI of a local PostgreSQL server}"

server_addr="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -Atc "select coalesce(host(inet_server_addr()), 'socket')")"
case "$server_addr" in
  socket | 127.* | ::1 | 172.* | 192.168.* | 10.*) ;;
  *)
    echo "extract: refusing to run against non-local server '$server_addr'" >&2
    exit 2
    ;;
esac

psql "$DB_URL" -v ON_ERROR_STOP=1 -q \
  -c "drop database if exists $SCRATCH_DB with (force)" -c "create database $SCRATCH_DB"
trap 'psql "$DB_URL" -q -c "drop database if exists $SCRATCH_DB with (force)"' EXIT
readonly SCRATCH_URL="$(node -e '
  const url = new URL(process.argv[1]);
  url.pathname = "/" + process.argv[2];
  process.stdout.write(url.toString());' "$DB_URL" "$SCRATCH_DB")"
run() { psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -q "$@"; }

# The three tables in the shape the migrations wrote to.
run <<'SQL'
create schema extensions;
create extension postgis with schema extensions;
create table public.cities (
  city_id text primary key, name_he text not null, name_en text not null,
  lat double precision, lon double precision);
create table public.streets (
  city_id text not null, street_id integer not null, name_he text not null,
  primary key (city_id, street_id));
create table public.road_junctions (
  junction_id integer primary key, kind text not null, name_he text not null, name_en text,
  name_ar text, roads text, lat double precision not null, lng double precision not null);
SQL

# 0008 also rewrites users; only its first statement (the bulk insert) is reference data.
awk '/^insert into public\.cities/ { on = 1 } on { print } on && /;[[:space:]]*$/ { exit }' \
  "$MIGRATIONS/0008_seed_all_cities.sql" | run
for f in 0023_cities_geo_backfill 0024_cities_geo_fixups 0089_cities_geo_bulk_backfill \
  0101_seed_streets 0513_seed_road_junctions; do
  run -f "$MIGRATIONS/$f.sql"
done

# Coordinates rounded to 7 decimals (about 1 cm) so a PROJ upgrade does not churn the files.
cd "$HERE/data"
run <<'SQL'
\copy (select city_id, name_he, name_en, lat, lon as lng from public.cities order by city_id collate "C") to 'cities.csv' with (format csv, header true)
\copy (select city_id, street_id, name_he from public.streets order by city_id collate "C", street_id) to 'streets.csv' with (format csv, header true)
\copy (select junction_id, kind, name_he, name_en, name_ar, roads, round(lat::numeric, 7) as lat, round(lng::numeric, 7) as lng from public.road_junctions order by junction_id) to 'road_junctions.csv' with (format csv, header true)
SQL
wc -l cities.csv streets.csv road_junctions.csv
