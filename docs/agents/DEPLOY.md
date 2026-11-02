# Deploy runbooks (find in &lt;1 minute)

## After merge to `dev` (automatic)

| What | Workflow | Target |
|---|---|---|
| DB migrations → Edge Functions → web → smoke | `Deploy` (`.github/workflows/deploy.yml`), after the dev push's **CI** run passes | Supabase **kc-dev** (`supabase-dev`) + Cloudflare Pages → `https://dev.karma-community.pages.dev/` |

Verify: `https://dev.karma-community.pages.dev/version.json` shows the merged SHA; the Deploy run's smoke stage is green. To redeploy dev, dispatch **Deploy** on `dev`.

## Local DB

```bash
./scripts/dev-up.sh          # Docker Supabase + apply migrations
cd app && pnpm install
cp app/.env.example app/.env.local   # use `supabase status` keys only
```

## Mobile release (manual)

See [RELEASE.md](./RELEASE.md): version bump → EAS preview → TestFlight / Play internal. Public store = Nave only.

## Seeding (kc-dev only)

| Need | How |
|---|---|
| Add a few reference/demo rows to kc-dev **without** wiping data | Idempotent migration (fixed ids + `on conflict … do update/nothing`). If the rows must never reach prod, guard the insert so it is a no-op without the kc-dev fake seed (example: `0400_kc_dev_demo_nonprofits.sql`). Also add the rows to `supabase/seed/kc-dev/seed.sql` so a reseed keeps them. |
| Full fake dataset (users, posts, chats …) | Actions → **Seed KC dev** (`seed-kc-dev.yml`, action `seed`). **Destructive:** wipes and recreates every `@seed.kc.test` row. Ask before running. Details: [`supabase/seed/kc-dev/README.md`](../../supabase/seed/kc-dev/README.md). |
| Remove the fake dataset | Same workflow, action `wipe`. |

Never seed prod. Seed credentials live only in the seed files; never paste them into code, issues, PRs or chat.

## DB types drift

`apply migrations · rls · types · sql probes` regenerates `app/packages/infrastructure-supabase/src/database.types.ts` on a fresh stack. If it fails with a diff, apply that exact diff to the file (or run `supabase gen types typescript --local | node scripts/strip-partition-types.mjs > …` locally with Docker; the filter drops the monthly partition tables, whose names change every month) and push again.

## Verify on dev (E2E)

Playwright QA suite against `https://dev.karma-community.pages.dev` + kc-dev: [`tests/e2e/README.md`](../../tests/e2e/README.md). Run on demand with Actions → **E2E nightly (dev)**, or locally `cd tests/e2e && npm ci && npx playwright test`.

## All workflows

| Workflow | Trigger | Notes |
|---|---|---|
| `ci.yml` (+ `ci-*.yml` lanes) | PRs, dev/main pushes | One required check, `CI gate` (`D-195`); PRs into `main` add the release lane (`ci-release.yml`) |
| `deploy.yml` (+ `deploy-*.yml` stages) | after a green dev/main push CI run / manual on dev or main | Only deploy path. dev automatic; prod waits for Nave's one approval on `production`. After a failure use **Re-run all jobs**, never **Re-run failed jobs** (the deploy guard refuses it on prod) |
| `deploy-smoke.yml` | manual | Read-only smoke against dev or prod |
| `seed-kc-dev.yml` | manual | Destructive dev reseed / wipe |
| `e2e-nightly-dev.yml` | nightly + manual | QA suite against dev |
| `k6-load-dev.yml` | manual | Load test against dev |
| `mobile-nightly.yml` → `testflight-ios.yml`, `play-internal.yml` | nightly + manual (dev) | Store builds of the newest green dev commit, see [RELEASE.md](./RELEASE.md) |
| `kc-mobile-eas-preview.yml` | manual | EAS preview build, no store submit |
| `sync-main-to-dev.yml` | main push | Opens a zero-diff PR into `dev`; the owner merges it as a merge commit with the admin bypass (`TD-182`) |
| `bump-version-on-merge.yml` | dev push | Bumps `app/VERSION` PATCH after each merge (`TD-196`); PRs do not edit VERSION |
| `auto-merge-agent-ready.yml`, `labeler.yml`, `bump-app-version.yml`, `stale-stack-report.yml` | PR / schedule | Housekeeping |

## Web (Cloudflare Pages)

Runbook: [docs/DEPLOY_WEB.md](../DEPLOY_WEB.md). The only web path is Cloudflare Pages through `deploy.yml` (dev and prod); Railway is retired, and the repo-root `Dockerfile` / `railway.json` are no longer deployed.
