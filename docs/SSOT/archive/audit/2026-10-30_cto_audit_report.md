# CTO Audit Report — Karma Community (KC)

| Field | Value |
|---|---|
| Audit date | 2026-10-30 |
| Audited ref | `origin/dev` @ `fdc861d3` (app `VERSION` 1.3.22) · compared against `origin/main` @ `b25a9d30` |
| Scope | Git topology, SSOT specs vs. code, dependencies, secrets, Supabase RLS / storage / Edge Functions, React Native architecture, CI/CD |
| Method | Static analysis of the repo + local gate runs (`pnpm install --frozen-lockfile`, `typecheck`, `test`, `lint`, `pnpm audit`). **No live database or production endpoint was queried.** Findings derived from migrations are marked *"migration-derived"* and must be confirmed against the live dev project before the fix ships. |

---

## 1. Executive Summary & Health Score

KC is an unusually well-governed codebase for its stage. The clean-architecture boundaries hold (zero forbidden imports from `domain`/`application`), every table has RLS, every `SECURITY DEFINER` function pins `search_path`, all third-party CI actions are SHA-pinned, and the three pre-push gates are green with ~2,965 passing tests.

The risk is concentrated in **storage-layer privacy** and **release/process plumbing**, not in application code:

1. **One critical and several high-severity security items** were found and reported privately to the PM (not described here — the repo is public).
2. **The deploy path has drifted**: production web is on Cloudflare Pages (static), while the share-preview server (FR-POST-023) and its Dockerfile still target Railway. ~50 merged PRs and 13 migrations sit on `dev` unreleased.
3. **The SSOT is drifting from reality**: three different Supabase project refs are documented as "dev", TD IDs have been reused for unrelated items, and several spec status headers advertise long-fixed bugs.

### Scorecard

| Dimension | Score | Rationale |
|---|:---:|---|
| Architecture | **8.5 / 10** | Strict layering enforced by `lint:arch`; ports/adapters respected; only 13 allowlisted >300-LOC files. Minus: composition-root duplication (§4.1), phantom routes (§4.2). |
| Code health | **8 / 10** | `strict: true` everywhere, 11 `any` sites, 1 runtime `console.log`, 0 lint errors / 123 warnings. Minus: 8 raw `Error` throws in `application`, no RN component-test infra (TD-150). |
| Test coverage | **7.5 / 10** | 2,965 unit tests across 5 packages + Playwright E2E + SQL probes. Gaps: Edge Functions mostly untested (TD-79), no RNTL. |
| Security & privacy | **6 / 10** | Strong DB posture; open items reported privately to the PM (§3). |
| Release readiness | **5.5 / 10** | Universal/App Links still placeholders, dead "Forgot password" button, no OTA channel (no `expo-updates`), dual web-hosting surfaces, large unreleased `dev` delta. |
| Process / SSOT integrity | **6.5 / 10** | Excellent intent and tooling; execution drift in the docs agents rely on. |
| **Overall** | **7.0 / 10** | **Architecturally production-grade; not launch-ready until the P0 list in §5 is closed.** |

### Gate results on `dev` (local run, Node 22.22, pnpm 9.15.9)

| Gate | Result |
|---|---|
| `pnpm typecheck` | ✅ 5/5 packages |
| `pnpm test` | ✅ domain 324 · application 735 · infrastructure 1,136 (+38 skipped integration) · mobile 735 · ui 35 |
| `pnpm lint` | ✅ 0 errors · 123 warnings (58 unused-vars, 25 `no-explicit-any`, 18 `exhaustive-deps`, 15 `no-require-imports`) |
| `pnpm audit` | 32 advisories (9 high, 19 moderate, 4 low); 15 ignored via `auditConfig`; **2 high not ignored** (`decode-uri-component`), so `--audit-level=high` **exits 1** (§3) |

---

## 2. Repository Reconnaissance (Phase 1)

### 2.1 Branch topology

| Branch | Tip | Status |
|---|---|---|
| `dev` | 2026-10-29 `fdc861d3` | Working branch. **~50 first-parent PRs and 13 migrations (`0429`–`0441`) ahead of `main`**; 353 files / +9.3k −3.2k lines. |
| `main` | 2026-10-27 `b25a9d30` | Last release "promote dev → main (migrations 0232–0427)". |
| `staging` | 2026-09-09 `872aecd4` | **Abandoned.** 2 commits not in `main`, 208 behind; last work is GloWe (sunset per `D-191`). |
| `production` | 2026-05-18 `b9e71b2d` | **Abandoned** for 5 months; not referenced by any deploy workflow. |
| Others | 63 branches | **54 have had no commits since 2026-08-31** (`claude/*`, `cursor/*`, `chore/TD-156-*`, `version-bump-*`). |

Note: `git rev-list main...dev` reports 320 commits because squash-promotions break ancestry; the real unreleased delta is the first-parent count above.

### 2.2 Directory map (code volume, `.ts/.tsx` only)

```
KC/
├── app/                              pnpm + turbo monorepo
│   ├── apps/mobile/                  Expo SDK 54 · RN 0.81 · React 19.1 · expo-router 6 (new arch ON)
│   │   ├── app/        142 files   17.1k LOC   expo-router routes (134 screens)
│   │   ├── src/        808 files   62.4k LOC   components, hooks, services (composition roots), i18n
│   │   └── web-server/             Hono OG/SPA server (Railway — see §3.6)
│   └── packages/
│       ├── domain/                 117 files    6.7k LOC   zero runtime deps ✅
│       ├── application/            414 files   18.9k LOC   use cases + ports
│       ├── infrastructure-supabase 248 files   39.7k LOC   adapters
│       └── ui/                      18 files    1.1k LOC
├── supabase/
│   ├── migrations/                 386 files (0001 → 0441, sequential)
│   └── functions/                  19 Edge Functions, 5.4k LOC
├── tests/e2e/                      Playwright journeys
├── loadtests/k6/
├── .github/workflows/              32 workflows
├── docs/SSOT/                      specs (18), BACKLOG, TECH_DEBT (120 rows), DECISIONS (1,571 lines)
└── PRD_V2_NOT_FOR_MVP/             out-of-scope product material
```

---

## 3. Security, Privacy & Risk Assessment (Phase 3)

> **Disclosure policy (project book rule #6):** this repository is public, so security findings are **not described here**. The full findings (severity, evidence, fix) were delivered **privately to the PM** and are tracked as private items `S-1`…`S-11` (1 critical, 3 high, 3 medium, 4 low). Fixes ship with neutral commit messages.

Public summary only:
- The database layer is in strong shape (see §3.9).
- The open items are concentrated in storage access configuration, client-side hardening, the web deployment surface, data-deletion completeness and CI automation.
- Third-party dependency advisories are public CVEs and are listed in `pnpm audit`; the `--audit-level=high` gate currently exits 1 because of two transitive `decode-uri-component@0.2.2` advisories (via Expo). A plain override is unsafe (the patched `0.5.x` is ESM-only), so they need a documented `ignoreGhsas` entry in `SECURITY.md`.

### 3.9 ✅ Verified-clean areas

- **Secrets:** no live credentials in tracked files or in the fetched history. The two JWTs in `sqlProbes.integration.test.ts:26` and `scripts/verify-local-mock-auth.mjs:4` are Supabase's public `supabase-demo` local keys. The RevenueCat `appl_…` key in `eas.json` is a public SDK key by design.
- **RLS:** 140/140 live tables have RLS enabled across 386 migrations.
- **`SECURITY DEFINER`:** 543 function definitions, all pin `search_path`.
- **CI supply chain:** 89/89 third-party actions SHA-pinned; both `pull_request_target` workflows run no PR code; every workflow declares top-level `permissions`.
- **Edge Functions:** `revenuecat-webhook` uses a constant-time compare; `whatsapp-webhook` verifies `X-Hub-Signature-256` and fails closed; `mock-login` hard-404s on hosted projects.
- **Dev-only auth shortcuts** are gated by `__DEV__` and dead-code-eliminated from release bundles.

---

## 4. Code Smells & Architectural Anomalies

### 4.1 Composition-root duplication
Twelve near-identical `pickStorage()` functions in `apps/mobile/src/services/`, and they are not all identical. Consolidate them into a single shared helper.

### 4.2 Phantom routes in `app/` (expo-router)
13 non-screen modules live inside the routes directory, so expo-router registers each one as a URL (e.g. `/settings.styles`, `/post/PostDetailScrollContent`). They produce "missing default export" warnings and on web are reachable paths that render blank or crash:

```
app/settings.styles.ts                 app/edit-profile.styles.ts
app/(tabs)/search.styles.ts            app/(tabs)/create.styles.ts
app/(guest)/feed.styles.ts             app/chat/chatScreenStyles.ts
app/edit-post/editPostScreen.styles.ts app/post/postDetailScreen.styles.ts
app/post/PostDetailScrollContent.tsx   app/research/{SurveyIntroBlock,ResearchRunner,ResearchQuestionPanel}.tsx
app/settings/survey/SurveyQuestionPanel.tsx
```
**Fix:** move them to `src/features/<area>/` (or use expo-router's `_`-prefix exclusion), and add a `lint:arch` rule that rejects any `app/**` file without a default export.

### 4.3 Single global error boundary
There is one `<ErrorBoundary>` in `app/_layout.tsx:169`, and **zero** route-level `export function ErrorBoundary`. A render error in any screen therefore takes down the whole shell, including the tab bar. Add route-segment boundaries for `(tabs)`, `chat`, `post` and `(admin)`, and report them to Sentry.

### 4.4 No OTA update channel
`eas.json` defines `preview` / `production` channels and `app.json` sets `runtimeVersion`, but **`expo-updates` is not installed**. Channels do nothing, critical fixes need a full store review, and the native language switch falls back to `DevSettings.reload` (`TD-178`). Install `expo-updates` before the first store release.

### 4.5 Two web-hosting surfaces
`deploy-web.yml` publishes a static bundle to **Cloudflare Pages**, while `Dockerfile` / `railway.json` / `web-server/server.mjs` still build the **Railway Hono** server that implements FR-POST-023 crawler OG cards (`D-38`). The Pages deploy has no Functions, so on the Pages-served domain `/post/<id>` previews fall back to the generic `index.html` card. Decide on one surface (Pages Functions are the natural port) and delete the other. The Dockerfile comment shows Railway is still kept alive only to satisfy a `main` branch-protection deployment check.

### 4.6 Error-class hygiene
There are 8 raw `throw new Error(...)` in `packages/application` (`SavePostUseCase.ts:8`, `UnsavePostUseCase.ts:8`, `IsPostSavedUseCase.ts:8`, `GetMyPostsUseCase.ts:30`, `CloseRideListingUseCase.ts:15`, …). This violates CLAUDE.md §5 ("never raw `Error`") and bypasses the typed error mapping to UI states.

### 4.7 Dead / residual code
- **"Forgot password" button is inert**: `app/(auth)/sign-in.tsx:128` is a `TouchableOpacity` with no `onPress` (FR-AUTH-008). Users with password accounts have no recovery path.
- **GloWe residue after sunset (`D-191`)**: `glowe-avatars` bucket, `GLOWE_PAGES_PREVIEW` CORS regex, `TD-180/181/185/186/187` (GloWe-only), and the abandoned `staging` branch.
- 58 `no-unused-vars` warnings. These are mechanical cleanup items.

### 4.8 Toolchain drift
- `.nvmrc` = `20`, the local runtime used here is Node 22, and CI mixes Node `20` and `22` (2 jobs each). `TD-189` documents that vitest 4 breaks on Node `<20.19`. Pin `.nvmrc` to `22` (an exact minor) and use it in every workflow via `node-version-file`.
- `app/package.json` declares `packageManager: pnpm@9.15.9`, but scripts shell out to `npx pnpm@9.15.9`. Use Corepack and drop the `npx` wrappers.

---

## 5. Spec vs. Implementation Gap Analysis (Phase 2)

### 5.1 Functional gaps (spec says ✅ or expected, code disagrees)

| FR / Item | Spec claim | Code reality | Severity |
|---|---|---|---|
| **FR-AUTH-008** Forgot password | Required | Dead button (§4.7) | 🟠 launch blocker for email/password users |
| **FR-AUTH-015** Soft gate | Gate follow + chat + post-create | `useSoftGate` referenced in 2 files only (post-create path) | 🟡 |
| **FR-POST-023** Share OG cards | ✅ via Hono (`D-38`) | Not served on Cloudflare Pages (§4.5) | 🟡 |
| **FR-POST visibility**, **FR-CHAT** media, **R-MVP-Privacy-6** | Privacy guarantees | Gaps reported privately to the PM (§3) | 🔴 |
| Deep links (`TD-66`) | Universal / App Links | Placeholder manifests | 🟠 launch blocker |
| **FR-NOTIF** Web push (`TD-65`) | Parity deferred | No web push | 🟢 tracked |

### 5.2 Documentation drift (SSOT says one thing, repo another)

| # | Drift | Impact |
|---|---|---|
| D-1 | **Three different Supabase refs are documented as "dev"**: `ENVIRONMENTS.md` → `enbqriuxvvuontiwslun`; `CLAUDE.md` §13, `.mcp.json`, `app/.mcp.json`, `docs/DEPLOY_WEB.md` → `roeefqpdbftlndzsvhfj`; an archived audit cites yet another prod ref. CLAUDE.md grants agents *full write authority* on "dev". | 🔴 operational risk: an agent could migrate the wrong project. **Founder must confirm the canonical refs.** |
| D-2 | `CLAUDE.md` §6 names the repo `KarmaCummunity/GloWe`; the remote is `KarmaCummunity/KC`. Its "Standard PR workflow" runs `gh pr create --base main`, contradicting "All PRs target `dev`" two lines above. | 🟠 agents follow the wrong recipe |
| D-3 | **TD IDs reused for unrelated items**: specs cite `TD-69` (privacyMode cast), `TD-75` (`messages_insert_user` regression), and `TD-79` (donation SSRF), but `TECH_DEBT.md` now uses those IDs for migration-drift guard, translation provider, and translate tests. | 🟠 traceability broken |
| D-4 | Stale spec headers: `spec/13_donations.md` still flags the SSRF as 🔴 open, but it is fixed in `validate-donation-link/index.ts:33-143`. Several other headers still list "Audit 2026-05-16" 🔴 items that `TECH_DEBT.md` marks ✅ (`TD-73/74/76/77/80`). | 🟡 misleads prioritisation |
| D-5 | `BACKLOG` P1.7 / P1.8 (public research) have been "🟡 post-merge QA" for months; `spec/11` FR-SETTINGS-015..017 likewise. | 🟡 QA debt hides real status |
| D-6 | `TD-182`: `sync-main-to-dev.yml` force-pushes (`git push -f`, line 58) and is always rejected by `dev` protection. | 🟢 noisy red job |
| D-7 | `0440_chat_media_storage_rls_user_first.sql` header says `0439_…`. | 🟢 cosmetic |
| D-8 | `DECISIONS.md` is 1,571 lines in a single file. | 🟢 split by year or domain |

---

## 6. Environment & Tooling Optimisation (Phase 4)

What is already strong and should be kept: turbo pipelines; `lint:arch` (file-size cap, layer rules, SSOT link check); `lint:i18n` Hebrew-literal scan; migration chain / safety / RPC-contract guards; migration-drift CI; Snyk + GitGuardian + Sonar + CodeRabbit; k6 + Lighthouse budgets; Playwright E2E on dev.

Recommended refinements:

| # | Change | Effort |
|---|---|---|
| T-1 | Raise `@typescript-eslint/no-unused-vars` and `no-explicit-any` from `warn` to `error` after a one-time cleanup (123 → 0 warnings). Warnings that never fail CI keep accumulating. | S |
| T-2 | Enable `noUncheckedIndexedAccess` in the 2 packages that lack it, and `exactOptionalPropertyTypes` in `domain` + `application` (only 1 package has it). | M |
| T-3 | `lint:arch` rule: every `app/**` file must default-export a component (closes §4.2 permanently). | S |
| T-4 | `lint:arch` rule: a single auth-storage adapter for the Supabase client. | S |
| T-5 | Unify Node: `.nvmrc` → `22.x`, `node-version-file: .nvmrc` in all workflows, `engines.node` in `app/package.json`. | S |
| T-6 | Add a Deno test job for `supabase/functions/**` (`TD-79`). Webhooks and `validate-donation-link` are the priority. | M |
| T-7 | Stand up RNTL + jest-expo for `@kc/mobile` (`TD-150`). Start with auth, chat composer, and delete-account. | M |
| T-8 | Branch hygiene: delete the 54 stale remote branches plus `staging` / `production` after founder sign-off, and add a weekly report of branches older than 30 days (`stale-stack-report.yml` exists — extend it). | S |
| T-9 | Add SQL regression probes for storage access policies. | S |

---

## 7. Prioritised Action Plan

### P0 — Immediate (this week; blocks launch)

| # | Action | Owner lane | Ref |
|---|---|---|---|
| P0-1 | Close the critical and high private security items (`S-1`, `S-2`). | BE + Infra | private |
| P0-3 | **Founder decision:** confirm the canonical dev / prod Supabase project refs; then fix `CLAUDE.md`, `ENVIRONMENTS.md`, `.mcp.json`, and `DEPLOY_WEB.md` in one PR. | Docs | D-1 |
| P0-4 | Wire FR-AUTH-008 Forgot Password (`resetPasswordForEmail` + deep-link landing route). | FE + BE | §4.7 |
| P0-5 | Fill the Apple Team ID and Android release SHA-256 into the `.well-known` manifests. **Needs credentials from the founder** (see below). | FE | TD-66 |
| P0-6 | Unblock the frontend CI audit gate: add a documented `ignoreGhsas` entry for the `decode-uri-component` highs. | Infra | §3 |

### P1 — Short term (next 2–4 weeks)

| # | Action | Ref |
|---|---|---|
| P1-1 | Consolidate `pickStorage()` into one helper, with a test and a lint rule. | §4.1, T-4 |
| P1-2 | Close the medium private security items (`S-3`…`S-7`). | private |
| P1-4 | Pin web-server dependencies via a lockfile; remove the stray lockfiles. | §4.5 |
| P1-5 | Choose one web surface; port the OG handler to Cloudflare Pages Functions; retire Railway. | §4.5 |
| P1-6 | Install `expo-updates` and wire EAS Update channels. | §4.4 |
| P1-7 | Move the 13 phantom-route modules out of `app/`; add the lint rule. | §4.2, T-3 |
| P1-8 | Add route-level error boundaries reporting to Sentry. | §4.3 |
| P1-9 | Release train: promote the current `dev` delta (13 migrations) to `main` after P0-1/P0-2, then move to a weekly cadence. | §2.1 |
| P1-10 | SSOT repair: renumber the colliding TD IDs, refresh stale spec headers, fix the CLAUDE.md repo name and PR recipe. | D-2..D-4 |

### P2 — Long term (quarter)

| # | Action | Ref |
|---|---|---|
| P2-1 | Signed URLs for restricted media (`TD-11`). | TD-11 |
| P2-3 | Deno test harness for Edge Functions; RNTL for mobile. | T-6, T-7 |
| P2-4 | Lint ratchet to `error`; stricter TS flags. | T-1, T-2 |
| P2-5 | Close `TD-68` and the low-severity private items. | TD-68 |
| P2-6 | Replace the 8 raw `Error` throws with domain error classes. | §4.6 |
| P2-7 | Close the QA debt on P1.7 / P1.8 / FR-SETTINGS-015..017, or downgrade their status honestly. | D-5 |
| P2-8 | Remove GloWe residue; prune stale branches; split `DECISIONS.md`. | §4.7, T-8, D-8 |

### Inputs required from the founder

| Need | Why |
|---|---|
| Canonical Supabase project refs for **dev** and **prod** | Resolves D-1. Agents currently hold write authority on an ambiguous target. |
| Apple Developer **Team ID** and the Android **release keystore SHA-256** | P0-5: Universal Links / App Links. |
| Approval to delete the `staging`, `production`, and 54 stale remote branches | T-8. Deleting branches I did not create needs your sign-off (CLAUDE.md §7). |
| Decision: Cloudflare Pages vs. Railway as the single web host | P1-5. |
