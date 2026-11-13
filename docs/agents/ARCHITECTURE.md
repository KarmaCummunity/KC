# KC architecture (agent map)

| Area | Path | Notes |
|---|---|---|
| Mobile + web export | `app/apps/mobile/` | Expo Router; `pnpm mobile` / `build:web` |
| Domain / use cases | `app/packages/{domain,application}/` | Pure TS; no I/O |
| Supabase adapters | `app/packages/infrastructure-supabase/` | Repos + generated `database.types.ts` |
| UI kit | `app/packages/ui/` | Shared RN components |
| Schema + RLS + RPCs | `supabase/migrations/` | Numbered on merge (`next-NN_slug.sql` in a PR); see [MIGRATION_RANGES.md](./MIGRATION_RANGES.md) |
| Edge Functions | `supabase/functions/` | Deno; WhatsApp, workers |
| CI / deploy workflows | `.github/workflows/` | PRs → `dev`; push to `dev` deploys kc-dev + Pages. Table in [DEPLOY.md](./DEPLOY.md#all-workflows) |
| Seeds | `supabase/seed/{reference,content,e2e}/` | Versioned, idempotent data loaders. See [DEPLOY.md](./DEPLOY.md#seeding-kc-dev-only) |
| E2E | `tests/e2e/` | Playwright against the dev site + kc-dev |
| Specs / backlog | `docs/SSOT/` | Product SSOT |
| Agent operating model | [OPERATING_MODEL.md](./OPERATING_MODEL.md) | Who merges, labels, flow |
| Release / stores | [RELEASE.md](./RELEASE.md) | Version + TestFlight/Play |
| Stack ownership | [STACK_MAP.md](./STACK_MAP.md) | Parallel PR stacks |

**Environments:** [docs/SSOT/ENVIRONMENTS.md](../SSOT/ENVIRONMENTS.md). **Never** push to `main` / kc-prod without Nave.
