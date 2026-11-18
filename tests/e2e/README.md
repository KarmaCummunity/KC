# E2E (Playwright)

User journeys against the deployed dev web app (`DEV_WEB_URL`, default
`https://dev.karma-community.pages.dev`) and the kc-dev Supabase project.

- **Users:** the e2e members of kc-dev (`user1@seed.kc.test` … `user4@seed.kc.test`, loaded by the **Seed KC dev** workflow, action `e2e-users`, from `supabase/seed/e2e/load.sql`; 
  password from the `E2E_SEED_PASSWORD` env / Actions secret, required). Override with `E2E_USER_A_EMAIL` / `E2E_USER_A_PASSWORD`,
  `E2E_USER_B_*` and `E2E_USER_C_*` (user3, the member outside what A and B share).
- **Anon key:** read from the deployed bundle (it is the public publishable key), or set
  `E2E_SUPABASE_ANON_KEY`.
- **Guard:** `lib/env.ts` refuses to run against the prod project or prod domain.
- Rows the suite creates are titled `[e2e <timestamp>] …`.

## Suites

| File | Covers |
|---|---|
| `journeys/items.spec.ts` | **two-user items journey (G40):** A publishes → B reserves → A confirms → A hands over (listing closed, karma) → B rates |
| `journeys/food.spec.ts` | **two-user food journey (G40):** A publishes with expiry → B quick-claims (confirmed at once) → A hands over → B rates |
| `journeys/animals.spec.ts` | **two-user animals journeys, all four kinds (§5.9, D125, #1027):** for an adoption offer and a foster offer, A publishes → B finds it in the animals feed and the main feed → B messages A from the post (the chat is anchored on it) → B reserves → A confirms → A hands over (listing closed, karma) → B rates; for the two requests (looking to adopt, looking for boarding), which take no handoff, the journey ends at that chat; then the animals world in English (LTR, no raw keys). The items and food journeys share the feed and chat steps (`lib/postDiscovery.ts`) |
| `journeys/world-links.spec.ts` | **links and knowledge of a world:** the food feed ends with a short list of links and a button, the button opens the dedicated screen; knowledge topics on the knowledge world; organizations and related worlds on a link-only world (medical); a world without a community list (items). Needs the content seed on kc-dev |
| `journeys/research-submit.spec.ts` | **public research form (FR-RESEARCH-001..003):** a visitor without an account opens the shared link, rates the 11 questions and sends; the gateway answers with the id of the stored row and the visitor lands on the thank-you page; a draft survives a reload and is cleared after sending. Writes one response per run, tagged `source = e2e-journey`. Needs the content seed on kc-dev |
| `journeys/research-share.spec.ts` | **share of the public research survey (FR-RESEARCH-004):** the thank-you page shares the attributed survey link through the share sheet, or copies it to the clipboard when the browser has none (both native surfaces are replaced by recorders) |
| `journeys/db-function-privileges.spec.ts` | **database function privileges (SEC-1063):** as a signed-out visitor, calls every database function the API exposes (names and arguments from the generated types) and expects `42501` for all but the reviewed public list; no browser, read-only |
| `journeys/chat-media-privacy.spec.ts` | **chat images are private (SEC-1064):** member A uploads an image into the chat with B (`chat-media`, `<sender>/<chat>/<file>`); B gets a signed URL and the URL serves the image; a member outside the chat (user3), the public key, a call without credentials and the public URL are all refused, even with the exact path; no browser, and the image is removed after the run |
| `journeys/worker-endpoints.spec.ts` | **worker endpoints (SEC-1067):** calls every Edge Function on the service-role-only list (read from `supabase/functions/_shared/serviceRoleGuard.ts`) without credentials, with the public key and as a signed-in member, and expects each to refuse (`401` or `403`); no browser, and a refused call runs nothing |
| `journeys/qa/auth.spec.ts` | email login with the seeded user, wrong password, sign-up form |
| `journeys/qa/feed.spec.ts` | feed renders without failed API calls, create a post, like, comment |
| `journeys/qa/marketplace.spec.ts` | browse, search, listing detail, create item with/without photo on the unified create screen (`/create?category=items`), reserve by a second user |
| `journeys/qa/social.spec.ts` | chat between two users, notifications inbox, donations hub, money world (active hub or portal per `world_money_enabled`), he/en + RTL |
| `journeys/qa/block-user.spec.ts` | block then unblock `user3@seed.kc.test` from the profile ⋮ menu (Apple 1.2) |
| `journeys/qa/report-issue.spec.ts` | report a problem from Settings (FR-MOD-002): Send disabled while too short, then the report opens the support thread and is stored there once (leaves one tagged report in user A's support thread) |
| `journeys/qa/account-deletion.spec.ts` | **opt-in, destructive**: delete account from Settings (set `E2E_DELETE_ACCOUNT_EMAIL` to a spare seed user) |
| `journeys/*.spec.ts` | P0 smoke journeys + the world journeys above (`lib/worldJourney.ts` holds the shared shape; a world is a fixture) |

## CI

- `.github/workflows/e2e-nightly-dev.yml`: nightly at 01:00 UTC and on demand; uploads the HTML report. `mobile-nightly.yml` also calls it with `p0_only` (top-level `journeys/*.spec.ts` only) before the store builds.
- `.github/workflows/ci-release.yml` (release lane of `CI gate`): on every dev → main PR, waits until dev serves the PR head SHA (`/version.json`), then runs the journeys.

## Local

```bash
cd tests/e2e
npm ci && npx playwright install chromium
npx playwright test            # or: PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome npx playwright test
```
