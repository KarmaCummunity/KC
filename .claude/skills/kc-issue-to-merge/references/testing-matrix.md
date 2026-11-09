# Testing matrix

Read at Phase 4. Decide the levels **before** writing code, then write each failing test first.
Full pyramid and CI lanes: [`docs/SSOT/TESTING.md`](../../../../docs/SSOT/TESTING.md).

## What changed → which tests are required

| Change | Required tests | Where | Run locally |
|---|---|---|---|
| Domain entity, value object, invariant | Unit: happy path + boundary + error | `app/packages/domain/**/__tests__/` | `pnpm --filter @kc/domain test -- <path>` |
| Use case or application port | Unit with an in-memory fake; a port contract case if the port has a contract suite | `app/packages/application/**/__tests__/`, `src/contracts/` | `pnpm --filter @kc/application test -- <path>` |
| Supabase adapter (`infrastructure-supabase`) | Unit on mapping/errors + the port's `*.contract.integration.test.ts` leg | `app/packages/infrastructure-supabase/**/__tests__/` | see "Port contract tests" in TESTING.md (local stack) |
| Migration, RLS policy, RPC, trigger, cron | DB test: allowed **and** denied actor, plus a lifecycle step in `flows/` when a world's status changes | `supabase/tests/*.sql`, `supabase/tests/flows/*.sql` | `supabase start && scripts/run-db-tests.sh supabase/tests/<file>.sql` |
| Edge Function | Deno `handler.test.ts` with mocked I/O | `supabase/functions/<fn>/` | `cd supabase/functions && deno test --allow-read <fn>/` |
| Mobile hook, store, util, component logic | Unit (vitest) | `app/apps/mobile/src/**/__tests__/` | `pnpm --filter @kc/mobile test -- <path>` |
| Screen or user journey (web) | Playwright spec, or a new case in the matching `journeys/qa/*.spec.ts` | `tests/e2e/journeys/` | `cd tests/e2e && npx playwright test <spec>` |
| Screen or user journey (native) | Maestro flow | `.maestro/flows/` | [`docs/process/MAESTRO.md`](../../../../docs/process/MAESTRO.md) |
| User-visible copy | Locale file entry; `pnpm lint:i18n` and `pnpm lint:hebrew-register` pass | `app/apps/mobile/src/i18n/locales/` | from `app/` |
| CI workflow or repo script | Script self-test (`scripts/*.test.mjs`); actionlint-clean workflow | `scripts/`, `.github/workflows/` | `node --test scripts/<name>.test.mjs` |
| Docs only | Link and registry guards | — | `pnpm lint:arch` from `app/` |

A change touching several rows needs every row's tests. One behavior is tested once, at the lowest level that can observe it. A journey test proves the wiring, not every branch.

## Rules

1. **Bug = regression test first.** At the lowest level that reproduces the bug. Commit or show it failing before the fix; name it after the behavior, not the issue number.
2. **Every acceptance criterion maps to at least one test.** List the mapping in the PR's Tests section.
3. **Happy path + at least one boundary or error case** per new unit (AGENTS.md §5).
4. **Never weaken a test to pass.** No `.skip`, `.only`, loosened assertion or deleted case. The test-integrity judge in `CI gate` rejects it.
5. **A decision that reverses behavior.** Old assertions that encode the old behavior are updated to the new expectation, never deleted. List each one in the PR's Tests section, with the decision that changed it.
6. **No real data or secrets in tests.** Seed users and fixtures only.
7. **Flaky test found?** Do not retry it until green. Open a finding (`references/findings.md`) with the seed and the failure log line.

## No local stack

Without Docker there is no local Supabase. In that case:
- **DB tests run only in CI** (the `backend` lane of `CI gate`). Write them anyway.
- **Say so in the PR's Tests section** ("DB: written, run by CI only"), and never mark them as run locally.
- **If a change needs dozens of existing DB suites updated,** split the server half into a child issue rather than push it blind.

## Levels CI runs for you

- **PR runs.** The `CI gate` runs unit, DB, contract and static lanes on the PR.
- **Nightly runs.** Playwright journeys and Maestro run nightly against kc-dev, not on PRs. Write and run the spec locally when a journey changes; CI will keep running it after the merge.
