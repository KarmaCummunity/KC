# `supabase/schemas` — source of the production baseline

The production database is built from **one baseline migration**. That file is generated; this
directory is where the schema is written and reviewed. Design: [`docs/db/target-design.md`](../../docs/db/target-design.md).

## Layout

```
supabase/schemas/<NN>_<module>/<NNN>_<topic>.sql   authored source (this directory)
supabase/baseline/0001_baseline.sql               generated — never edit by hand
supabase/baseline/tests/*.sql                     pgTAP tests, run against a database built from the baseline
supabase/baseline/local/supabase_shim.sql         stand-in for the Supabase platform objects on plain Postgres
```

Files are concatenated in path order, so a module may only reference objects from an earlier
module or an earlier file of its own.

## Rules

1. One topic per file, at most 300 lines. Module folders are `NN_snake_case`, files `NNN_snake_case.sql`.
2. Number files in steps of ten (`010_`, `020_`, …) so a file can be inserted without renaming others.
3. No data. Reference data and demo data live in `supabase/seed/`.
4. Every table enables and forces row level security in the file that creates it.
5. Nothing is granted to `anon` or `authenticated` implicitly: each grant is written next to the object it opens.
6. A function belongs in `public` only when a client or an Edge Function calls it by name. A predicate used inside a policy goes to `kc_access` with an explicit `grant execute … to authenticated`; everything else goes to `kc_private`.
7. Every `security definer` function sets `search_path = ''` and schema-qualifies every name.

## Commands

```bash
node scripts/assemble-baseline.mjs           # regenerate supabase/baseline/0001_baseline.sql
node scripts/assemble-baseline.mjs --check   # fail when the generated file is stale (also run by the script self-tests)
scripts/run-baseline-tests.sh                # build a scratch database from the baseline and run the pgTAP tests
```

The baseline is **not** in `supabase/migrations/` yet: the incremental chain stays the deployed
schema until the cut-over step of the design (§10).
