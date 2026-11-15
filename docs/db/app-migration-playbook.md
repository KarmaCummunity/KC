# Application migration playbook — moving one adapter onto the baseline

> For the agent that owns a work package (P1–P6, L1–L7) of [`app-migration-map.md`](./app-migration-map.md) § 5. Follow the steps in order; parallel agents doing the same thing the same way is the point. Design: [`target-design.md`](./target-design.md) §9, §12.1.

> **Status: complete.** Every package (P1–P6, L1–L7) is moved. The legacy view is removed: `database.legacy.types.ts`, `getLegacySupabaseClient`, `legacySupabase` and `LegacyDatabase` are gone, and the scan in `migrationStatus/scan.ts` now reports any legacy reference anywhere. The frozen pre-baseline types live in [`pre-baseline-schema.types.ts`](./pre-baseline-schema.types.ts) as the "old" side of the migration map only; nothing compiles against them. The sections below describe how the move was done.

## 0. What P0 left you

| Piece | Where | What it does |
| --- | --- | --- |
| Baseline types | `app/packages/infrastructure-supabase/src/database.types.ts` | The **one generated** types file (`node scripts/gen-baseline-types.mjs`). Never edit by hand. |
| Frozen legacy types | `.../src/database.legacy.types.ts` | Copy of the old generated types. Never regenerated, never edited. Imported **only** by unmigrated files. Deleted with the last entry. |
| Two typed views of one client | `client.ts` | `getSupabaseClient()` returns `SupabaseClient<Database>` (baseline). `getLegacySupabaseClient()` returns the same singleton typed `SupabaseClient<LegacyDatabase>`. `getSupabaseClient<D>()` is generic so a call that is passed straight to a legacy constructor infers `D` from the parameter. |
| Mobile composition root | `apps/mobile/src/lib/container.ts` | `supabase` (baseline) and `legacySupabase` (old schema): the same connection. Unmigrated repositories are built with `legacySupabase`. |
| Allow-list | `.../src/migrationStatus/<P1..L7>.ts` | One file per package, one path (relative to `app/`) per unmigrated file. You edit **only your package's file**. |
| Compatibility test | `.../src/__tests__/baselineCompatibility.test.ts` | Fails if an unlisted file still needs the old schema, and if a listed file no longer does. |
| Degrade rule | `rpc/backendUnavailable.ts`, `rpc/mapRpcError.ts`, `@kc/domain` errors, `apps/mobile/src/lib/backendAvailability.ts`, locale keys `backend.*` | See § 3. |
| FSM registry | `@kc/domain` `FSM_MACHINES` | Equal, row for row, to the `kc_private.fsm_state` / `fsm_edge` seeds in `supabase/schemas` (`src/fsm/__tests__/catalogMatchesSql.test.ts`). |

A file is **unmigrated** when it imports `database.legacy.types`, uses `getLegacySupabaseClient` / `legacySupabase` / `LegacyDatabase`, or [`app-usage-inventory.json`](./app-usage-inventory.json) records a call in it to an object the baseline does not provide (an RPC missing from `Functions`, a table missing from `Tables` / `Views`, a bucket / channel / Edge Function whose map row is not `same`).

## 1. Before you start

1. Claim the work per `docs/agents/ISSUE_CLAIMS.md`; branch from `origin/dev` (`feat/<issue>-mobile-<package>-<slug>`).
2. Read your package in the map (§ 5: *Owns*, *Work*, *Must pass*, *If reached before it is migrated*, *Risks*) and the **row** of every object your files use (§ 3, same file in `app-migration-map.json`): status (`same`, `renamed`, `changed`, `removed`, `missing`), target, note, `missing` id (M##).
3. Read the baseline source of every target object in `supabase/schemas/**` (signature, errors it raises, grants) and the spec section (`node scripts/spec.mjs <file>`); the spec wins over the map.
4. Run `cd app && pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` once so you know the starting state is green.
5. Touch only your package's folders. A change to a shared file (`client.ts`, `index.ts`, `rpc/**`, `lib/**`, `fsm/**`, domain FSM, `container.ts` outside your lines, another package's `migrationStatus` file) goes to the P0 owner: say so in the PR instead of editing it.

## 2. Moving one adapter (repeat per file)

1. **Switch the types.** In the file change `from '../database.legacy.types'` to `from '../database.types'` (same names: `Database`, `Json`). Run `pnpm typecheck`: the compiler now lists every call that no longer matches. Do not cast around an error with `as any` or `as unknown as`.
2. **Apply the map row** to each flagged call:
   - `same` / `renamed`: rename the function or the arguments; keep the port.
   - `changed`: follow the note (new RPC, a `post_card` instead of follow-up queries, keyset `next_cursor` instead of offset, integer `*_agorot` money, `follows` instead of `follow_edges`, ...). Rewrite the mapper (`map*Row`) from the new `Row` / `Returns` type, not from the old one.
   - `removed`: delete the call and its port method; delete the use case and screen code that only served it.
   - `missing`: the capability does not exist yet. Apply the **degrade rule** (§ 3) and write one line in the PR naming the M## id. Do not invent an RPC and do not add SQL: ask for it in the baseline.
3. **Errors.** Wrap every call: `return unwrapCall('rpc:<name>', await client.rpc('<name>', args))` (or `'table:<name>'`, `'fn:<name>'`, `'bucket:<name>'`). It throws `BackendUnavailableError` for a missing object and `BackendRuleError(reason)` for a stable `P0001` message. Map `reason` strings (never SQLSTATE, never Hebrew text) to your module's application error (for example `ChatError`) in the adapter's own `map*Error` function. Codes the app never referenced (marked † in the map) need a user-visible message in `locales/he` **and** `locales/en`.
4. **Ports and use cases.** If the new shape needs a different port (cursor instead of offset, a card type, a removed method), change `packages/application` in the same PR with a `(contract)` commit scope and update its tests. Domain types for new vocabularies live in `@kc/domain` (status lists must equal the FSM machine states; `statusVocabularies.test.ts` checks the existing ones).
5. **Composition.** In `apps/mobile/src/lib/container.ts` (or the feature's `*Composition.ts`) construct the repository with `supabase` (baseline) / `getSupabaseClient()` instead of `legacySupabase` / `getLegacySupabaseClient()`. Direct calls in screens and hooks: same replacement; unwrap with `unwrapCall`.
6. **Remove the entry.** Delete the file's line from `app/packages/infrastructure-supabase/src/migrationStatus/<YOUR_PACKAGE>.ts`. If the file also appears in a different package's list (a shared mapper), leave that one and say so in the PR.
7. **Tests, test-first.** Each adapter has a unit test with a fake client (`__tests__/`): update it to the new objects; add a case for the happy path, one `BackendRuleError` reason, and one missing-object case (`{ code: 'PGRST202' }` -> `BackendUnavailableError`). A bug fix starts with a failing test. Integration tests (`*.integration.test.ts`) must run against a baseline database (`scripts/run-baseline-tests.sh` builds one locally; see the brief for `DB_URL`), never against the old schema.
8. **Gates**, from `app/`: `pnpm typecheck && pnpm test && pnpm lint`. The compatibility test must pass: it proves the file is clean (no stale entry) and that nothing else of yours still needs the old schema. Root checks: `node --test scripts/*.test.mjs`, `node scripts/gen-baseline-types.mjs --check`.

When the last file of your package is moved, your `migrationStatus` file is `export const <ID>_UNMIGRATED: readonly string[] = [];`. When **every** package file is empty the compatibility test also requires `database.legacy.types.ts` to be gone: the final package deletes it, `getLegacySupabaseClient`, `legacySupabase`, `LegacyDatabase`, `LEGACY_FSM_MACHINES` and the legacy mentions in `client.ts` / `container.ts` / `index.ts` (ask the P0 owner).

## 3. The degrade rule

An adapter call that hits a **missing** backend object must not crash the screen and must not look like an empty success by accident.

**What counts as missing** (`isBackendObjectMissing`, `rpc/backendUnavailable.ts`; everything else is a real error):

| Signal | Kind |
| --- | --- |
| PostgREST `PGRST202`, Postgres `42883` | function |
| PostgREST `PGRST205`, `PGRST200`; Postgres `42P01`, `3F000` | table / view / relationship / schema |
| PostgREST `PGRST204`; Postgres `42703` | column |
| Postgres `42501` **and** message `permission denied for function/table/view/schema/sequence ...` (a missing grant) | by word |
| Edge Function call answered HTTP 404 (`FunctionsHttpError`) | edge_function |
| Storage `Bucket not found` (`StorageApiError`) | bucket |

`42501` alone is **not** missing: baseline RPCs raise `42501` + `unauthenticated` for a signed-out caller, and an RLS refusal also uses it.

**Adapter side:** `unwrapCall(object, result)` (or `mapRpcError`) throws `BackendUnavailableError(object, kind)` (domain error, code `backend_unavailable`). Never catch it inside the adapter to return fake data.

**Screen side** (`apps/mobile/src/lib/backendAvailability.ts`):

- a **list**: load through `listOrEmpty(() => useCase.run())` -> empty state (use `listUnavailableMessage()` for the caption if the screen has one);
- an **optional value**: `valueOrNull(...)`;
- an **action**: `const outcome = await runAction(() => useCase.run(...))`; on `outcome.status === 'unavailable'` show `notAvailableMessage()` (key `backend.notAvailableYet`, Hebrew + English);
- a **world** whose `world_<slug>_enabled` flag is off never renders its entry points (hub tile, tab, create category): gate with `useLaunchWorldEnabled(flagKey)` / `useMarketplaceWorldLaunchEnabled(slug)`. Do not rely on the call failing;
- any other error is rethrown: no screen reads `error.message` of an unknown error.

For `launch: later` rows with action `defer` the map says to hide the entry point behind its flag; for `drop` remove it. The degrade rule is the safety net, not the plan.

## 4. Rules that hold everywhere

- One issue and one package per PR; small PRs (about 600 lines); files at most 300 lines, 3 indentation levels (`pnpm lint:arch`).
- Domain code throws `DomainError` subclasses; no Supabase imports in `domain` / `application`.
- Money is integer agorot; paging is keyset (`next_cursor`), never offset; lists of posts are `post_card` rows.
- Status columns are never client-writable; use the RPC. FSM roles come from the registry, not from the screen.
- No Hebrew outside `locales/he` (CI guard), and add every new key to `locales/en` too (`localeParity.test.ts`). A locale file you touch must satisfy the copy-voice guard in full.
- Do not edit `database.types.ts` (regenerate) or `database.legacy.types.ts` (frozen), `supabase/migrations`, `.github/`.
- If you find an object the map does not list, or a map row that is wrong, fix `scripts/app-migration-map.rows.mjs` and regenerate (`node scripts/app-migration-map.mjs`), and note it in the PR.

## 5. PR checklist

- [ ] Files moved: list them; their lines are gone from `migrationStatus/<ID>.ts`.
- [ ] `pnpm typecheck && pnpm test && pnpm lint` green; compatibility test green.
- [ ] Every `missing` / `removed` row handled as the map says (degrade, hide, or delete); M## ids named.
- [ ] Tests: happy path, one stable-reason error, one missing-object case, per adapter.
- [ ] PR body: `Closes #N`, `Mapped to spec: ...`, opened-by label, base `dev`.
