# Contributing to Karma Community (KC)

Thank you for helping improve KC. Process rules for agents: [`CLAUDE.md`](CLAUDE.md).

## Scope

**KC mobile + web export** (`app/apps/mobile/`) and the **shared Supabase backend**
(`supabase/`, `app/packages/**`) are in scope.

The former GloWe static site was removed (see `D-190` in [`docs/SSOT/DECISIONS.md`](docs/SSOT/DECISIONS.md)).

## Local setup

1. `./scripts/dev-up.sh` — Docker + local Supabase + migrations
2. `cd app && pnpm install`
3. Copy `app/.env.example` → `app/.env.local` with keys from `supabase status`
4. `pnpm mobile` or `pnpm ios` / `pnpm android`

EAS and store CI: [`app/apps/mobile/README.md`](app/apps/mobile/README.md).

## Pull requests

- Target branch: **`dev`** (not `main`)
- Do not edit `app/VERSION` (PATCH is bumped automatically on merge into `dev`)
- Pre-push (from `app/`): `pnpm typecheck && pnpm test && pnpm lint`
- Include **Mapped to spec** in the PR body (see `CLAUDE.md`)

Agree to [CLA.md](CLA.md) when opening a PR.
