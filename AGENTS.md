# AGENTS.md — start here

KC (Karma Community) is built largely by AI agents. This is the short entry point; full rules are in [`CLAUDE.md`](./CLAUDE.md).

| Read | For |
|---|---|
| [`docs/agents/OPERATING_MODEL.md`](docs/agents/OPERATING_MODEL.md) | Roles, the issue → PR → dev → kc-dev flow, labels, auto-merge |
| [`docs/agents/ISSUE_CLAIMS.md`](docs/agents/ISSUE_CLAIMS.md) | **Claim an issue before starting it**: skip `in-progress` issues |
| [`docs/agents/MIGRATION_RANGES.md`](docs/agents/MIGRATION_RANGES.md) | **Claim a migration number range before writing SQL** |
| [`docs/agents/STACK_MAP.md`](docs/agents/STACK_MAP.md) | Open stacked PRs and merge order |
| [`docs/agents/ARCHITECTURE.md`](docs/agents/ARCHITECTURE.md) | Apps / packages / supabase / workflows map |
| [`docs/agents/DEPLOY.md`](docs/agents/DEPLOY.md) | **Deploy runbooks**: DB, web, seeding, types drift, E2E, all workflows |
| [`docs/agents/RELEASE.md`](docs/agents/RELEASE.md) | Versioning, TestFlight / Play internal, rollback |
| [`docs/architecture/adr/`](docs/architecture/adr/) | **ADRs**: client state (ADR-001), data layer + new-RPC checklist (ADR-002), realtime (ADR-003) |
| [`CLAUDE.md`](./CLAUDE.md) | Architecture, gates, PR template, prohibitions |

## Product focus

- **Mobile / web export:** `app/apps/mobile/**` (Expo, Hebrew RTL)
- **Backend:** `supabase/**` + `app/packages/infrastructure-supabase/**`
- GloWe was removed in `0238_drop_glowe_product.sql`. Do not reintroduce it.

## Branch naming

`<type>/<issue#>-<area>-<slug>`: `type` ∈ `feat|fix|refactor|chore|docs|test|ci`, `area` ∈ `db|mobile|marketplace|bot|social|infra|docs`. Example: `feat/905-marketplace-map`. Always branch from `origin/dev`.

## Scope rules

- One issue per PR. Stay inside the issue's "files likely touched" and "out of scope" lists.
- Don't edit another role's paths without saying so in the PR (see Roles).
- Small PRs (≤ ~600 changed lines unless generated). Files ≤ 300 lines (`pnpm lint:arch`).
- PR base is always `dev`. **Never** `main`, kc-prod, or prod deploy workflows without Nave's explicit approval.
- No secrets in code, logs, issues or PRs.

## Definition of done

- [ ] Gates green locally (from `app/`): `pnpm typecheck && pnpm test && pnpm lint`
- [ ] New or changed behavior has tests
- [ ] Migrations, if any: numbered inside your claimed range, apply cleanly on a fresh stack (`./scripts/dev-up.sh`), RLS plus policy tests, no destructive ops (migration safety scan in the `static` lane of `CI gate`)
- [ ] DB types regenerated and committed if the API surface changed
- [ ] PR labeled with exactly one opened-by label (`agent:cursor|kc-bot|antigravity|codex|other` or `human`), matching the `Opened by:` line ([ISSUE_CLAIMS.md](docs/agents/ISSUE_CLAIMS.md))
- [ ] PR body: `Closes #N` and `Mapped to spec: …`, following the CLAUDE.md §6 template
- [ ] `CI gate` green, then label `agent-ready` to auto-merge
- [ ] After merge: verified on kc-dev / dev.karma-community.pages.dev

Store builds (TestFlight / Play internal): see [`app/apps/mobile/README.md`](app/apps/mobile/README.md).

## Migrations rule

Every schema change must be a committed file in `supabase/migrations/NNNN_snake.sql`, applied only via `supabase db push` / the **Deploy** workflow. **Never** use the Supabase MCP `apply_migration` tool on any KC project (dev or prod). The `CI — migration drift` workflow scans the dev ledger against the **dev** branch's files (pinned with `ref: dev`, since scheduled runs execute from `main`). See `CLAUDE.md` §9 and `docs/SSOT/OPERATOR_RUNBOOK.md` → "Migration application rules".
