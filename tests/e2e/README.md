# E2E (Playwright)

User journeys against the deployed dev web app (`DEV_WEB_URL`, default
`https://dev.karma-community.pages.dev`) and the kc-dev Supabase project.

- **Users:** the public kc-dev seed users (`user1@seed.kc.test`, `user2@seed.kc.test`,
  password from the `E2E_SEED_PASSWORD` env / Actions secret, required). Override with `E2E_USER_A_EMAIL` / `E2E_USER_A_PASSWORD`
  and `E2E_USER_B_*`.
- **Anon key:** read from the deployed bundle (it is the public publishable key), or set
  `E2E_SUPABASE_ANON_KEY`.
- **Guard:** `lib/env.ts` refuses to run against the prod project or prod domain.
- Rows the suite creates are titled `[e2e <timestamp>] …`.

## Suites

| File | Covers |
|---|---|
| `journeys/items.spec.ts` | **two-user items journey (G40):** A publishes → B reserves → A confirms → A hands over (listing closed, karma) → B rates |
| `journeys/food.spec.ts` | **two-user food journey (G40):** A publishes with expiry → B quick-claims (confirmed at once) → A hands over → B rates |
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
