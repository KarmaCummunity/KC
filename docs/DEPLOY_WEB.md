# Web Deployment — Cloudflare Pages

Operator runbook for the static web export of the Expo Router app. Pipeline details: [`docs/SSOT/ENVIRONMENTS.md` § Deploy pipeline](./SSOT/ENVIRONMENTS.md#deploy-pipeline-d-195-infra-ci-3); release steps: [`docs/SSOT/RELEASE_CHECKLIST.md`](./SSOT/RELEASE_CHECKLIST.md).

## Targets

| Branch | Cloudflare Pages project / branch | URL | GitHub environment |
| ------ | --------------------------------- | --- | ------------------ |
| `dev` | `karma-community` / `dev` | `https://dev.karma-community.pages.dev` | `cloudflare-dev` |
| `main` | `karma-community` / `main` (production branch) | `https://karma-community-kc.com` | `cloudflare-prod` |

## Deploy flow

1. A PR merges into `dev` (merge queue), or a `dev` → `main` release PR merges.
2. The push runs **CI**; when its `CI gate` is green, **Deploy** (`.github/workflows/deploy.yml`) starts for that exact commit. Prod first waits for the owner's approval.
3. The web stage (`deploy-web.yml`) builds the export on the runner with the environment's `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and `EXPO_PUBLIC_ENVIRONMENT`, stamps `/version.json` with the SHA, and uploads it with `wrangler pages deploy --branch=<dev|main> --commit-hash=<sha>`.
4. The smoke stage (`deploy-smoke.yml`) waits for `/version.json` to report the SHA and checks the page, bundles, Auth health and Edge Functions.

Nothing deploys on push alone, and nothing is configured in the Cloudflare dashboard beyond the project. To redeploy dev, dispatch **Deploy** on `dev`.

## Local commands

| Command | Purpose |
| ------- | ------- |
| `pnpm build:web` (from `app/`) | Produce `app/apps/mobile/dist/` the way CI does (`expo export -p web` + `_redirects`, `_headers`, `version.json`). |
| `pnpm preview:web` (from `app/`) | Serve the local `dist/` with SPA fallback on `localhost:3000`. |

## Verifying a deploy

```bash
curl -sS https://dev.karma-community.pages.dev/version.json      # → the deployed SHA
curl -sSI https://dev.karma-community.pages.dev/donations        # → 200 (SPA fallback via _redirects)
```

Manual smoke in a browser: feed loads → donations grid → sign-in → post detail. Hebrew RTL must render correctly.

## Rollback

- **Prod:** automatic when the functions, web or smoke stage fails and the release applied no migrations (`deploy-rollback.yml`). By hand: Cloudflare dashboard → Pages → `karma-community` → Deployments → previous production deployment → *Rollback*.
- **Dev:** revert the commit on `dev`; the next green push redeploys.

## Supabase Auth redirect URLs

OAuth flows need the deployed origin in Supabase → Authentication → URL Configuration → **Redirect URLs** (`https://dev.karma-community.pages.dev/**` on kc-dev `enbqriuxvvuontiwslun`, `https://karma-community-kc.com/**` on prod).

## Shared links (`/post/:id`, `/user/:handle`)

The upload carries Cloudflare Pages Functions (`app/apps/mobile/functions/`, logic and tests in `app/apps/mobile/web-edge/`, `FR-POST-023`). `deploy-web.yml` writes the function's config (`app/scripts/write-web-edge-config.mjs`: the public Supabase URL and anon key, and the optional store URLs) and runs `wrangler pages deploy` from `app/apps/mobile`, where Wrangler looks for `functions/`. Per request, by User-Agent: a link-preview crawler gets an Open Graph card for the post's kind; an iOS or Android browser is redirected to the store when its URL is set; everyone else gets the SPA.

| Setting (GitHub environment `cloudflare-<target>`) | Kind | Effect |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | secrets (already set for the build) | where the card reads the post |
| `KC_IOS_STORE_URL`, `KC_ANDROID_STORE_URL` | variables, https URL | store a phone without the app is sent to; unset = stays on the website |

Verify after a deploy: the smoke's `sharedlinks` check, or by hand `curl -sSA 'WhatsApp/2.0' https://dev.karma-community.pages.dev/post/<id> | grep og:title`. `?web=1` on any shared link forces the website. Rollback: revert the commit; the function and the SPA deploy together.

## Historical: Railway (retired)

Before Cloudflare Pages, the web build ran on Railway from a repo-root `Dockerfile` at `dev3.karma-community-kc.com`, serving `dist/` through a Hono server (OG cards for `/post/:id`). Cloudflare Pages replaced it, and the Pages Functions above replaced the Hono server, which is removed from the repo (`TD-234`).
