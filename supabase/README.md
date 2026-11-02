# Supabase — Karma Community

This directory holds SQL migrations and seed data for the **public** schema.
The hosted Supabase project's URL and keys live in `.env` / the dashboard;
this folder is committed and review-able.

## Layout

```
supabase/
├── config.toml              # CLI config (project_id, ports, auth redirects)
├── migrations/              # ordered SQL migrations
│   └── 0001_init_users.sql  # P0.2.a — Foundation & Identity
├── seed.sql                 # data inserted on `supabase db reset` (cities ref)
└── README.md
```

## Migration numbering (mandatory)

Each file under `migrations/` must use a **unique** leading version token (the
digits before the first `_`). Supabase records that token in
`supabase_migrations.schema_migrations`; two files such as `0021_foo.sql` and
`0021_bar.sql` both map to version `0021` and will break `db push` with a
duplicate-key error.

Rules:

1. **Never reuse the same numeric prefix** for two different migration files.
2. **Add new work only** with the next free integer prefix after the current
   maximum in `supabase/migrations/` (run `ls supabase/migrations` and bump the
   highest `NNNN_*.sql` by one).
3. **Do not renumber** migrations that may already be applied on hosted
   projects unless you coordinate a repair baseline with the team.

## Apply a migration to the live project

Two options:

### 1. CLI (preferred)

```bash
# one-time, per machine:
cd /path/to/your/clone/of/GloWe
supabase login
supabase link --project-ref <project-ref>

# every migration after that:
supabase db push
```

### 2. Dashboard SQL editor

Copy the contents of the migration file into Supabase Dashboard → SQL editor → Run.
Always run migrations in numeric order.

## After applying — regenerate types

```bash
supabase gen types typescript --project-id <project-ref> \
  | node scripts/strip-partition-types.mjs \
  > app/packages/infrastructure-supabase/src/database.types.ts
```

Commit the regenerated file.

## WhatsApp matching bot — Edge secrets (#842–#846)

Configure in Supabase Dashboard → Edge Functions → Secrets (names only; never commit values):

| Secret | Used by |
|--------|---------|
| `WHATSAPP_VERIFY_TOKEN` | `whatsapp-webhook` (GET challenge) |
| `WHATSAPP_APP_SECRET` | `whatsapp-webhook` (signature HMAC) |
| `WHATSAPP_CLOUD_API_TOKEN` | `whatsapp-sender` (outbound Graph API sends) |
| `WHATSAPP_PHONE_NUMBER_ID` | `whatsapp-sender` |
| `WHATSAPP_GRAPH_API_VERSION` | Optional override (default in `whatsapp_channel_config`) |
| `WHATSAPP_SKIP_SIGNATURE_VERIFY` | Local/dev only when app secret unset |

RPC contract for MCP adapters: `docs/SSOT/MCP_MARKETPLACE_BOT_CONTRACT.md`.

## Slice plan

See `docs/SSOT/archive/superpowers/plans/2026-05-07-p0-2-db-schema-rls.md` for the full
P0.2 decomposition (P0.2.a..f). Each slice ships its own migration file and
its own commit.
