# ADR-002 — Data layer: RPCs, tables, repositories, types

- **Status:** Accepted (2026-10-30) · records the contract the code already follows
- **Issue:** KC#1016 · **Decision log:** `D-194` in [`../../SSOT/DECISIONS.md`](../../SSOT/DECISIONS.md)
- **Related:** [`MIGRATION_RANGES.md`](../../agents/MIGRATION_RANGES.md), [`OPERATOR_RUNBOOK.md`](../../SSOT/OPERATOR_RUNBOOK.md) "Migration application rules", CLAUDE.md §5 / §9

## Context

All persistence goes through Supabase (Postgres + RLS). Around 124 client-facing functions exist (`rpc_*` 36, `admin_*` 39, `api_*` 49) beside direct table access, and `infrastructure-supabase` makes about 200 `.rpc()` calls. Without a written rule, each feature picked its own mix of table writes, RPCs, error strings and grants. That cost us `database.types.ts` drift, functions callable by `anon`, and adapters that throw raw `Error`.

## Decision

### 1. Where code lives

```
apps/mobile (composition root) → application (use case + I*Repository port) → domain (types, errors)
                                   ↑ implemented by
                    infrastructure-supabase (Supabase*Repository adapters)
```

- A port (`I*Repository`) in `@kc/application` names the operation in domain terms; an adapter in `@kc/infrastructure-supabase` is the **only** code that calls `.rpc()` / `.from()`. `domain` and `application` never import Supabase.
- Adapters map snake_case rows to readonly domain objects in a pure, exported `map*Row` function that has its own unit test.
- Accepted shortcut: a read-only feature with no business rules may expose an infra repository directly through a composition module (e.g. `matchingComposition` → `SupabaseMatchRepository`). Anything with rules gets a use case.

### 2. RPC or direct table access

| Use | When | Examples |
|---|---|---|
| **Direct `select`** | Reads fully expressed by RLS (visibility = policy), simple filters, keyset pagination on an index | feed views, own profile |
| **Direct `insert`/`update`/`delete`** | A single row the caller owns, no cross-row invariant, columns limited by column grants (`0196`) | own user fields, own media rows |
| **`rpc_*` (SECURITY DEFINER)** | Anything multi-row, multi-table or rule-bearing: state transitions, counters, karma, notifications, rate limits, cross-user effects | `rpc_my_matches`, `rpc_match_respond` |
| **`admin_*`** | Admin portal operations; first statement is `admin_assert_role(auth.uid(), array[...])` mirroring `PERMISSION_MATRIX` | `admin_match_quality`, `admin_search_users` |
| **`api_*`** | Service-role entry points for Edge Functions, the WhatsApp bot and MCP tools (#835); never granted to `authenticated` | `api_whatsapp_queue_outbound` |
| **Internal helpers** | Called only from other SQL (triggers, crons, engines) | `match_deliver_pending`, `enqueue_notification` |

Rules for every function:

- `security definer` + `set search_path = public` (+ `pg_temp` when it creates temp objects). Derive the actor from `auth.uid()`; never trust a caller-supplied user id for authorization (the id parameter is only checked against `auth.uid()`).
- Functions are private by default (`0520`): a new function is executable by its owner and `service_role` only, so internal helpers need no grant. A client RPC grants itself in the same migration: `grant execute … to authenticated`, plus `to anon` for a public read or an RLS predicate guests evaluate (and add it to the anon list in `supabase/tests/0520_*`). An RLS predicate needs the grant for every role its policy applies to.
- An Edge Function that acts with the service role for pg_cron or an operator (not for the app) accepts only the service-role key: it calls `isServiceRoleRequest` from `supabase/functions/_shared/serviceRoleGuard.ts` right after its method guard and is listed in `SERVICE_ROLE_ONLY_FUNCTIONS`, whose regression test checks that the guard runs before any work.
- Guards: `supabase/tests/0161_*`, `0198_*`, `0520_*` (defaults, trigger functions, internal helpers, the anon list, RLS predicates) and `scripts/check-rpc-grants.mjs` (CI backend lane: every RPC the app calls is executable by a client role).
- Clamp every caller-controlled limit or window (e.g. `least(greatest(p_limit, 1), 50)`).
- `create or replace` keeps grants. Changing the return type needs `drop function` first, which is destructive: avoid it, or follow the migration-safety rule.

### 3. RLS expectations

- Every new table: `enable row level security` in the creating migration, with an explicit policy for each access path. No table is readable "by default".
- Policies use `(select auth.uid())` so it is evaluated once per statement (advisor `auth_rls_initplan`, `0354`).
- Writes that bypass RLS happen only inside SECURITY DEFINER functions that check the actor themselves.
- New storage buckets need object policies scoped by the path's owner prefix (see `0440`, `0445`).
- A bucket whose objects are not public content is private and read through signed URLs. `chat-media` (`0521`): an object is readable when its path names a chat `is_chat_visible_to` the caller, the same predicate as the chat's messages; the app signs `media_payload.path` (`apps/mobile/src/services/chatMediaUrl.ts`) and never stores a public URL.

### 4. Errors

- SQL raises a stable machine code, never prose for the UI: `42501` forbidden, `22023` invalid argument, `P0002` not found, project codes `P00xx` (e.g. `P0017 target_not_found`, `P0020 target_already_moderated`) with a short `detail`.
- The adapter maps `{ code, message }` to a **typed error**, a domain error class (`WhatsAppAdminError`, `AdminTaskError`, …) or an application error (`PostError`, `AuthError`), via a small `toError()`; the UI maps the domain error to localized text (`map*ErrorToHebrew` / i18n keys). Stack traces and raw Postgres messages never reach the UI.
- Some older adapters still throw `new Error(\`op: ${message}\`)`. New adapters must use a domain error; convert old ones when you touch them.

### 5. Generated types and contract checks

- `app/packages/infrastructure-supabase/src/database.types.ts` is generated, never hand-edited: `supabase gen types typescript --local | node scripts/strip-partition-types.mjs > …` (drops monthly partition child tables, whose names follow the current month) after applying your migration locally. CI fails on drift ("apply migrations · rls · types · sql probes").
- `scripts/check-rpc-contract.mjs` (CI "rpc · table contract") fails when the adapter calls an RPC or table that no migration defines.
- Adapters type rows from `Database['public']['Functions'][name]['Returns']` / `Tables[name]['Row']`, not hand-written shapes.

### 6. Migrations

- Sequential files `supabase/migrations/NNNN_snake_case.sql`. Claim the number in [`MIGRATION_RANGES.md`](../../agents/MIGRATION_RANGES.md) in the same PR, and check open PRs for the same number before pushing.
- Applied to kc-dev only by the **Deploy** workflow (database stage) / `supabase db push`. **Never** with the MCP `apply_migration` tool (it records a timestamp version and breaks the next deploy).
- Wrap in `begin; … commit;`; additive and backward compatible. Destructive statements need `migration-safety: allow` with a justification (`scripts/check-migration-safety.mjs`, run by the static lane of CI; for a release into `main` the release lane also requires a `Migration safety: <file> — <reason>` line in the PR body).

## Checklist — adding an RPC

1. Port method in `@kc/application` (or a composition-only read, §1), named in domain terms.
2. Migration (claimed number): `security definer`, `search_path`, actor from `auth.uid()`, role gate for `admin_*`, clamped inputs, the client grant (`to authenticated`, `to anon` only for public reads; none for internal helpers), `comment on function`.
3. New table? RLS on, a policy for each access path, `(select auth.uid())`.
4. SQL test in `supabase/tests/NNNN_*.sql`: happy path, refusal (`42501` / not callable by `anon`), at least one boundary, all inside `begin; … rollback;`.
5. Regenerate `database.types.ts` from the local DB; no other diff should appear.
6. Adapter: typed from `database.types.ts`, pure `map*Row` + unit test, `{code}` → domain error.
7. Use case + unit tests (happy + error) in `application/__tests__`.
8. Docs: the domain spec FR, plus `MATCHING_V2.md` / runbooks when the area has one; `app/VERSION` PATCH.

## Consequences

- Business rules live in one place (SQL functions) and stay enforceable for every client: app, web, bot, MCP.
- More migrations and SQL tests per feature; the local Supabase stack (`supabase db start`) is part of the dev loop.
- Existing raw-`Error` adapters and table writes outside these rules stay until touched (opportunistic, CLAUDE.md "Propose and Proceed").
