# Production copy tools (kc-dev only)

The functions that add the weekly anonymized copy of production to kc-dev (FR-ADMIN-037,
`docs/spec/requirements/12_super_admin.md`). **DEV ONLY**: kc-dev, a local stack or a scratch
test database. They are a seed, not a migration, so kc-prod never gets them (decision `D-239`).

The weekly job reads kc-prod, anonymizes the rows inside that same step and hands kc-dev one
JSON document; `kc_private.prod_copy_apply(jsonb)` adds it to kc-dev's data in one transaction.
Nothing here reads production, and nothing here sees a real name, address or contact detail.

| File | What |
| --- | --- |
| `install.sql` | Creates or replaces the tools (`lib/*.sql`). No marker, no data. Safe to run again |
| `load.sql` | `install.sql`, then sets the dev marker that lets a copy be applied. Refuses unless `kc.seed_target = 'dev'` |
| `lib/10_scope.sql` | `kc_private.prod_copy_state` (dev marker, last copy), what counts as copied, the counts and "Delete copied data" |
| `lib/20_members.sql` | Members: added, updated in place, removed when gone from production |
| `lib/30_posts.sql` | Posts with their ride, event, food or housing row: added, replaced when changed, removed when gone; a post kc-dev refuses is skipped and counted |
| `lib/40_social.sql` | Organizations (public fields), follows and saved posts between copied rows |
| `lib/50_apply.sql` | `kc_private.prod_copy_apply(jsonb)`, the one entry point, and the document format number |
| `lib/60_admin_rpcs.sql` | `admin_prod_copy_status`, `admin_delete_prod_copy`: the Demo data screen's "Copied from production" card (AC13). They admit the demo-data managers (`kc_private.require_demo_data_manager` of `supabase/seed/demo`, installed first by every dev deploy) |
| `anonymizer-words.json` | The Hebrew words of `scripts/prod-copy-anonymize.mjs` (removal mark, fake names) |

## What is copied

Copied members are `prodcopy-…@seed.kc.test` accounts with `app_metadata.prod_copy = true` and
no password, so nobody can sign in as one, and the demo wipe (FR-ADMIN-031) never matches them.
Copied posts are public and show their city only. A ride, event or food offer whose time has
passed is refused by kc-dev's own rules and skipped. Follows and saves are touched only when
both ends are copied, so a kc-dev tester's follow of a copied member stays.

## Run

On kc-dev nothing has to be run: every dev deploy installs the tools after the migrations
(`deploy-db.yml`, step **Production-copy tools (kc-dev only)**). Locally:

```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -c "select set_config('kc.seed_target', 'dev', false)" -f supabase/seed/prod-copy/load.sql
```

Tests: `supabase/tests/127_prod_copy.sql`, `supabase/tests/128_prod_copy_admin.sql`.
