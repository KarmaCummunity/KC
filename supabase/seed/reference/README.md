# Reference data (cities, streets, road junctions)

Rows the product cannot run without, in **every** environment: the city list, the official
street list and the named road junctions. They are not part of the baseline (the schema holds
no data) and they are not demo data: demo data lives in `supabase/seed/kc-dev/` and never
reaches kc-prod, reference data is loaded into kc-prod, kc-dev and local stacks alike.

## Files

| File | Rows | Columns |
| --- | --- | --- |
| `data/cities.csv` | 1,306 | `city_id`, `name_he`, `name_en`, `lat`, `lng` (14 localities have no coordinates) |
| `data/streets.csv` | 63,565 | `city_id`, `street_id`, `name_he` |
| `data/road_junctions.csv` | 449 | `junction_id`, `kind`, `name_he`, `name_en`, `name_ar`, `roads`, `lat`, `lng` |
| `load.sql`, `load.sh` | | the idempotent loader |
| `extract-from-migrations.sh` | | how the CSV files were produced (provenance, see below) |

The files are sorted by key (`city_id` in byte order, then `street_id`; `junction_id`) and
coordinates are WGS84 decimal degrees, so a refresh produces a reviewable diff.

## Sources and attribution

| Data | Source | Licence / attribution as recorded in this repository |
| --- | --- | --- |
| City codes and names | data.gov.il locality list, resource `5c78e9fa-c2e2-4771-93ff-7f400a12f7ba` (migration `0008`) | not stated in the repository |
| City coordinates | `akivaschiff/israel-geolocation` `src/locations.json`, snapshot 2026-05-16; 27 localities from OpenStreetMap Nominatim; two manual corrections (`3400`, `3658`); about 30 large cities set by hand earlier (migrations `0023`, `0024`, `0089`) | israel-geolocation: MIT. OpenStreetMap data: licence not stated in the repository |
| Streets | data.gov.il package `321`, resource `9ad3862c-8391-4b2f-84a4-2d4c68625f4b`, unfiltered (engineering decision D-36; migration `0101`, generator `scripts/generate-streets-seed.mjs`) | not stated in the repository |
| Road junctions | Ministry of Transport "junction and interchange names", data.gov.il package `zmt_names`, resource `09bbc3b7-7289-4beb-97c7-a10ebc4973c6`, existing places only (product decision D98; migration `0513`, generator `scripts/import-road-junctions.mjs`) | CC BY; the source is credited in the app's About screen (D98) |

Where the licence is "not stated", confirm it before the first production load.

## Loading

```bash
REFERENCE_DB_URL=<connection URI of the target database> supabase/seed/reference/load.sh
```

- The connection must be a role that owns the tables and is exempt from row level security
  (`postgres` on a Supabase project). Client roles cannot write these tables.
- Order inside the one transaction: **cities → streets → road junctions** (streets reference
  cities). Run it after the baseline is applied and before any member signs up.
- Idempotent: `insert … on conflict do update`, and a row is rewritten only when it differs
  from the file. The loader prints, per table, the rows in the file and the rows it changed;
  a second run prints `0` changed.
- `location` is built by the loader from `lat` / `lng`; the tables store a geography point
  only. Street centroids are not in the source, so `streets.location` stays as it is.
- The loader never deletes. A row that disappears from a file stays in the database, because
  members, posts and rides may reference it; retiring a place is a reviewed migration.

## Refreshing

The CSV files were extracted once from the incremental migrations, which were the only place
the rows existed (`extract-from-migrations.sh` replays those statements into a throwaway local
database and exports them). The legacy `tel-aviv` slug row that migration `0667` re-inserts on
kc-dev is a duplicate of city `5000` and is deliberately not carried over.

After the cut-over to the baseline the migrations are gone and the CSV files are the source:
refresh a file from its upstream source (the two generator scripts above describe the mapping),
keep the sort order, review the diff, and run the loader.
