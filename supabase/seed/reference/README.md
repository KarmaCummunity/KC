# Reference data (cities, streets, road junctions, giving-world catalog, feature flags)

Rows the product cannot run without, in **every** environment: the city list, the official
street list and the named road junctions. They are not part of the baseline (the schema holds
no data) and they are not demo data: the retired demo data lives in `supabase/archive/seed-kc-dev-demo/` and never
reaches kc-prod, reference data is loaded into kc-prod, kc-dev and local stacks alike.

## Files

| File | Rows | Columns |
| --- | --- | --- |
| `data/cities.csv` | 1,306 | `city_id`, `name_he`, `name_en`, `lat`, `lng` (14 localities have no coordinates) |
| `data/streets.csv` | 63,565 | `city_id`, `street_id`, `name_he` |
| `data/road_junctions.csv` | 449 | `junction_id`, `kind`, `name_he`, `name_en`, `name_ar`, `roads`, `lat`, `lng` |
| `data/worlds.csv` | 12 | giving worlds with sensitivity, geo mode and main-feed flag |
| `data/post_kinds.csv` | 9 | kinds of post of the launch worlds (items, food, rides, time) |
| `data/item_subcategories.csv` | 15 | item and food subcategories |
| `data/app_flags.csv` | 12 | one `world_<slug>_enabled` flag per world; launch worlds on (D102), the rest off. Created only when missing: a re-run never undoes the super admin's switch |
| `load.sql`, `load.sh` | | the idempotent loader |
| `extract-from-migrations.sh` | | how the CSV files were produced (provenance, see below) |

The files are sorted by key (`city_id` in byte order, then `street_id`; `junction_id`) and
coordinates are WGS84 decimal degrees, so a refresh produces a reviewable diff.

## Sources and attribution

Licence check of 2026-11-11 (issue #2079): every source is free to use, including commercially,
with attribution. The PM sign-off to load kc-prod was given on 2026-11-11. This is a read of the
licence terms, not legal advice. The attribution strings below are shown on the app's About
screen (`aboutContent.footerDataCredit*` in `aboutContentCopyA.ts`, he and en); keep them in step.

| Data | Source | Licence | Attribution required |
| --- | --- | --- | --- |
| City codes and names | data.gov.il package `citiesandsettelments`, resource `5c78e9fa-c2e2-4771-93ff-7f400a12f7ba` (Population and Immigration Authority; migration `0008`); fetched 2026-11-08 | data.gov.il general data licence (https://data.gov.il/terms-of-use; CKAN `license_id = other-open`). Commercial and non-commercial use, copying, redistribution and derivative works allowed | Yes: state the source |
| Streets | data.gov.il package `321`, resource `9ad3862c-8391-4b2f-84a4-2d4c68625f4b` (Population and Immigration Authority), unfiltered (D-36; migration `0101`, generator `scripts/generate-streets-seed.mjs`); fetched 2026-11-01 | Same data.gov.il general data licence | Yes, same reason (the list is loaded unchanged) |
| Road junctions | Ministry of Transport and Road Safety "junction and interchange names", data.gov.il package `zmt_names`, resource `09bbc3b7-7289-4beb-97c7-a10ebc4973c6`, existing places only (D98; migration `0513`, generator `scripts/import-road-junctions.mjs`) | CC BY | Yes: credit the Ministry and name the licence |
| City coordinates (bulk) | `akivaschiff/israel-geolocation` `src/locations.json`, snapshot 2026-05-16 | MIT | Keep the copyright notice in the third-party notices |
| 27 city coordinates | OpenStreetMap Nominatim | ODbL 1.0. Share-alike is not triggered: 27 features is far below the OSMF "Substantial" guideline's 100-feature line, and the OSMF Geocoding guideline treats individual geocoding results as insubstantial extracts. A one-off extraction; do not aggregate into a substantial copy of OSM | Yes: "© OpenStreetMap contributors" |

Other coordinate sources: two manual corrections (`3400`, `3658`); about 30 large cities set by
hand earlier (migrations `0023`, `0024`, `0089`).

### Attribution strings (About screen)

- Cities and streets: `Place and street lists: Population and Immigration Authority, via the Israeli Government Databases portal (data.gov.il), used under the data.gov.il open data licence.`
- Junctions: `Junction and interchange names: Ministry of Transport and Road Safety, data.gov.il, licensed under CC BY (https://creativecommons.org/licenses/by/4.0/).`
- OpenStreetMap: `© OpenStreetMap contributors (ODbL 1.0)`, link https://www.openstreetmap.org/copyright
- MIT notice: `israel-geolocation, Copyright (c) 2025 akivaschiff, MIT License.`
- Required by the data.gov.il licence (no implied endorsement, as is): `This app is not an official government service and is not endorsed by the State of Israel. The data is provided as is; the official publications prevail over the data shown.`

### What the data.gov.il licence forbids

Misleading or distorting presentation, cross-referencing that harms a person's privacy, and
implying official status or State endorsement. The licence version in force when the data was
fetched governs, so keep the fetch dates above with the files.

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

Since the cut-over to the baseline the old migrations are history (`supabase/migrations/archive/`) and the CSV files are the source:
refresh a file from its upstream source (the two generator scripts above describe the mapping),
keep the sort order, review the diff, and run the loader.
