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
| Reference data (cities, streets, junctions) | Actions → **Seed KC dev**, action `reference` (`supabase/seed/reference/load.sh`). Idempotent. |
| Content (organization links, legal texts, surveys, the platform organization) | Same workflow, action `content` (`supabase/seed/content/load.sh`). Idempotent; classification in [`supabase/seed/content/README.md`](../../supabase/seed/content/README.md). |
| The e2e members `user1`…`user4@seed.kc.test` | Same workflow, action `e2e-users` (`supabase/seed/e2e/load.sql`; password from the `E2E_SEED_PASSWORD` secret). Idempotent. |
| All three | Action `all`. |
| A change to reference or content data | Edit the CSV under `supabase/seed/`, run the loader, review the diff in the PR. Seeds are data, never migrations. |

The old fake Hebrew dataset (posts, chats, follows) was retired with the migration chain; it is kept for reference in `supabase/archive/seed-kc-dev-demo/`.

Never seed prod. The seed password lives only in the `E2E_SEED_PASSWORD` Actions secret; never paste them into code, issues, PRs or chat.

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

Runbook: [docs/DEPLOY_WEB.md](../DEPLOY_WEB.md). The only web path is Cloudflare Pages through `deploy.yml` (dev and prod); Railway is retired and its `Dockerfile` / `railway.json` / Hono server are removed; shared-link cards and the store redirect run as Pages Functions in the same upload (see the runbook).
