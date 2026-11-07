# Testing & Quality Gates

> **Audience:** AI agents implement and maintain tests; humans validate product behavior on dev/prod URLs.
> **Operating model:** Agents ship via PRs to `dev`; production releases are PRs `dev` → `main`. Humans do not run `pnpm test` locally as a gate — CI + E2E do.

## Pyramid

All PR checks run behind the single required check `CI gate` (`.github/workflows/ci.yml`, `D-195`); the lanes below are jobs inside it, planned from the changed paths.

1. **Unit** — `cd app && pnpm test` (vitest). `frontend` lane of `CI gate`.
2. **Contract / migrations / DB flows** — `backend` lane (fresh local stack, `supabase/tests/*.sql`, types drift, sqlProbes) and the RPC contract + migration-chain checks in the `static` lane. DB tests run through `scripts/run-db-tests.sh` (shared `kc_test` harness, per-migration tests, per-world lifecycle flows) — see [`supabase/tests/_harness/README.md`](../../supabase/tests/_harness/README.md).
3. **Bundle smoke** — `scripts/smoke-web-bundle.mjs` on the exported dist. `frontend` lane.
4. **E2E (Web)** — Playwright vs `DEV_WEB_URL`. **Required** on PR `dev` → `main` (P0 journeys, `release` lane), plus the nightly QA suite.
5. **Performance** — Lighthouse + k6. Scheduled on `dev` (Wave 4); blocking only after budgets stabilize.
6. **Accessibility** — axe Playwright on critical routes (Wave 5).
7. **Native E2E** — Maestro. Nightly until stable (Wave 6).

## CI feedback lanes (agents)

| Event | Checks | E2E |
| --- | --- | --- |
| PR → `dev` (and its merge-queue group) | `CI gate`: hygiene (PR runs only), static guards, plus the frontend / backend / edge lanes the diff needs | none |
| PR → `main` (release) | same, plus the `release` lane | **P0 journeys required** against `DEV_WEB_URL` once it serves the release head SHA |
| push → `dev` / `main` | every lane, then **Deploy** (kc-dev automatically; prod after the owner's approval) with its smoke stage | none |
| nightly | — | QA suite (`e2e-nightly-dev.yml`); P0 journeys before the mobile store builds (`mobile-nightly.yml`) |

## Port contract tests (G39, `D-204`)

One suite per application port, written once and run twice:

| Leg | Where | Runs |
| --- | --- | --- |
| In-memory fake | `app/packages/application/src/<area>/__tests__/*.contract.test.ts` against a behavioural `InMemory*Repository` | every `pnpm test` (frontend lane) |
| Supabase adapter | `app/packages/infrastructure-supabase/src/<area>/__tests__/*.contract.integration.test.ts` against the real adapter with a signed-in (RLS-scoped) client | `ci-backend` on the local stack; `vitest.config.ts` collects these files only when `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are set (the lane exports them from `supabase status -o env`) |

The cases live in `app/packages/application/src/contracts/<port>.contract.ts` as a plain `ContractCase[]` with framework-agnostic assertions (`ContractViolation`), so the module ships in `@kc/application` without a vitest import and any adapter package can import it. A fake that drifts from the adapter fails the same case the adapter passes.

Adding a port: write `contracts/<port>.contract.ts` (fresh actors per case; a second actor only where the port's behaviour is two-sided, as a bookmark on another user's post is — admin flows and ranking stay in per-adapter tests), a behavioural in-memory fake beside the use-case tests, the two runners, and export the contract from `contracts/index.ts`. Run the adapter leg locally: `supabase start`, then `eval "$(supabase status -o env)"` and `SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY pnpm --filter @kc/infrastructure-supabase test contract.integration`. No stack key is ever written in the repo (GitGuardian scans every PR), and the suite files carry no skip marker (the test-integrity judge rejects added ones).

Shipped: `IPostRepository`, `ISavedPostsRepository` (the posts-area fakes share one `InMemoryPostStore`, whose `isPostVisibleTo` models the owner / hidden-status / OnlyMe slice of `is_post_visible_to`), `IChatRepository` (11 participant-side cases over one `InMemoryChatStore`: one thread per pair, paging, the 2000-character body limit, unread counts, inbox rows, participants-only access, personal inbox hide; the support thread needs a super admin and stays in its own tests), `IReportRepository` (8 cases over user and chat targets; its fake shares the chat store's members and chats, and post / listing targets stay in the DB tests), the follow graph (the follow / follow-request slice of `IUserRepository`, typed as a `Pick` so the fake implements only what the 10 cases use), and profile editing (the Edit Profile / onboarding slice, `ProfileEditing`, 11 cases; its fake models the `public.users` CHECKs, the city foreign key and the owner-only update policy). The adapter legs share the seeded, signed-in users of `infrastructure-supabase/src/__tests__/contractUsers.ts`. Queue: BACKLOG `OPS-G39`.

## Two-user world journeys (G40, `D-205`)

`tests/e2e/journeys/<world>.spec.ts` — one Playwright journey per live giving world, two seeded users, against the dev deployment:

1. **A publishes** through `create_marketplace_listing` (the RPC the unified create form calls), so the journey tests the giving flow, not the form widgets (the form has its own qa spec).
2. **B claims** on the listing page — items reserve (`reserved`, owner must confirm), food quick-claims (`confirmed` at once, migration 0383).
3. **A confirms** when the world needs it; **A hands over** — the listing closes and the giver's karma ledger row exists; **B rates** — the rating is stored for the rater (D24).

Every UI step is re-read over REST as the acting user, so RLS is exercised as in the app. The shape lives once in `tests/e2e/lib/worldJourney.ts`; a world is a fixture (`kindSlug`, claim action and the status it results in, kind details such as food expiry). Locators prefer the `giving-handoff-*` / `handoff-rating-*` testIDs and fall back to the Hebrew labels. No skip markers: a step that cannot run fails.

Runs: nightly (`e2e-nightly-dev.yml`), the mobile nightly P0 gate and the release lane (`ci-release.yml`) — top-level `journeys/*.spec.ts`. A PR-time run would exercise the previous dev deployment, not the PR, so journeys are not a PR lane.

Shipped: `items`, `food`. Queue: BACKLOG `OPS-G40`.

## E2E test user (dev only)

**Manual / agent super-admin user** (Supabase dev `enbqriuxvvuontiwslun`). CI no longer uses it: the Playwright suites sign in as the public kc-dev seed users ([`tests/e2e/README.md`](../../tests/e2e/README.md)).

| Field | Value |
| --- | --- |
| Email | `karmacommunity2.0@gmail.com` (wired to `E2E_TEST_EMAIL`) |
| Password | GitHub secret `E2E_TEST_PASSWORD` — **never commit** |
| Auth user id | `a46d79c2-8818-4fea-8c6a-4fc60b5097d0` |
| Role | **super-admin** (`users.is_super_admin = true`) |

Re-create if deleted: `source ~/.kc-dev-secrets.env && node scripts/create-e2e-user.mjs` (uses service role from management API).

The repository secrets `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD` and `E2E_SUPABASE_ANON_KEY_DEV` are no longer read by any workflow.

Because this account is a **super-admin**, it lands on the admin portal (`/(admin)`) rather than the public home feed on first paint; a session for it must switch to the Home tab (`getByRole('tab', { name: 'בית' })`) first.

The human `/sign-in` UI may be broken — E2E uses API session injection, not that form.

Preflight: `set -a && source ~/.kc-dev-secrets.env && set +a && node scripts/ensure-e2e-user.mjs`
- **Auth in E2E (option 3):** Playwright injects the Supabase session into `localStorage` via API — no Google SSO, no `/sign-in` form, no `EXPO_PUBLIC_DEV_*` shortcuts.

## Agent test users (dev only)

Two canonical "looks-real" users for AI agent testing on Supabase dev `enbqriuxvvuontiwslun`.
Unlike the CI E2E user above, these users have completed onboarding, realistic Hebrew profiles,
and are used for multi-user interaction tests (chat, post closure, follow flows, etc.).

### Agent Alpha — moderator admin

| Field | Value |
| --- | --- |
| Email | `agent-alpha@karma-community.test` |
| Password | local secret `AGENT_ALPHA_PASSWORD` (or `AGENT_TEST_PASSWORD`) — **never commit** |
| Display name | דניאל לוי |
| City | תל אביב יפו |
| Admin role | **moderator** (`admin_role_grants`) — portal + reports + chat moderation + user/post search |
| `onboarding_state` | `completed` |

### Agent Beta — regular user

| Field | Value |
| --- | --- |
| Email | `agent-beta@karma-community.test` |
| Password | local secret `AGENT_BETA_PASSWORD` (or `AGENT_TEST_PASSWORD`) — **never commit** |
| Display name | מיכל כהן |
| City | ירושלים |
| Admin role | none — plain community member |
| `onboarding_state` | `completed` |

### Why two users?

- **Alpha alone:** auth flows, admin portal, moderation actions, admin-level RLS queries.
- **Alpha + Beta:** inter-user flows — follow requests, direct chat, post closure with recipient,
  "close from chat" lifecycle, report-submission (Beta reports Alpha's content), RLS persona suite (Wave 3).

### Admin role comparison

| Permission | super_admin (CI E2E user) | moderator (Alpha) | none (Beta) |
| --- | --- | --- | --- |
| Admin portal access | ✅ | ✅ | ❌ |
| Reports + moderation | ✅ | ✅ | ❌ |
| Grant/revoke admin roles | ✅ | ❌ | ❌ |
| All audit logs | ✅ | ❌ (own only) | ❌ |
| Regular community actions | ✅ | ✅ | ✅ |

> **Why not super_admin for Alpha?** The DB enforces a single active `super_admin` at a time
> (`admin_role_grants_single_super_admin_uniq` index). The existing CI E2E user holds that slot.
> `moderator` covers all agent-testable admin flows.

### Provisioning

```bash
# Add to ~/.kc-dev-secrets.env (never commit):
# AGENT_ALPHA_PASSWORD='...'
# AGENT_BETA_PASSWORD='...'

source ~/.kc-dev-secrets.env
node scripts/create-agent-test-users.mjs   # idempotent — safe to re-run
node scripts/ensure-agent-test-users.mjs   # verify both can sign in
```

### Using in E2E / agent code

Like the CI E2E user, agent tests should inject Supabase sessions via API rather than
driving the sign-in UI form. Inject per-user:

```typescript
// auth helper (Playwright)
const session = await signInWithPassword(
  process.env.AGENT_ALPHA_EMAIL,
  process.env.AGENT_ALPHA_PASSWORD,
);
await page.evaluate((s) => localStorage.setItem('supabase.auth.token', JSON.stringify(s)), session);
```

For multi-user tests, maintain two separate Playwright `BrowserContext` objects — one per user —
so cookies and localStorage are isolated.

---

## P0 release journeys (automated)

Maps to `RELEASE_CHECKLIST.md` dev smoke:

1. Auth — sign in with E2E user.
2. Feed — home feed renders (posts or empty state, not error).
3. Write — create-post screen loads; title field accepts input.
4. Chat — inbox screen opens.

## GloWe suite (historical)

The GloWe frontend, its Playwright projects (`glowe*`, `prod-health`) and their workflows (`ci-e2e-glowe.yml`, `glowe-prod-smoke.yml`, `seed-glowe-dev.yml`) were removed with the GloWe sunset (`D-190`). Only stale screenshot baselines remain under `tests/e2e/journeys/glowe-visual.spec.ts-snapshots/`.

## Flake protocol (agents)

1. First red without app change → re-run the workflow once.
2. Second red → open a `tech-debt` issue with a reproducer; only then `test.fixme` with TD id if release is blocked.
3. Never merge `dev` → `main` with a quarantined P0 spec.
4. If E2E fails but manual dev works → fix the test or selectors; do not weaken product assertions.

## Selectors

- Prefer `testID` on React Native (`testID` → `data-testid` on Web).
- Fallback: `getByRole` with stable Hebrew copy (document i18n key in spec comment).

## Human PM check (5 min, prod only)

After merge to `main`: incognito prod URL, sign-in, one write path, chat inbox. See `RELEASE_CHECKLIST.md` post-deploy section.

## Deploy smoke (`INFRA-QA-W7`)

The smoke stage of **Deploy** (`deploy-smoke.yml`, `scripts/smoke-deploy.mjs`) runs after every dev and prod deploy: `/version.json` SHA, page + bundle, Supabase Auth health, every Edge Function. It can also be dispatched read-only against dev or prod. There are no scheduled production synthetics.
