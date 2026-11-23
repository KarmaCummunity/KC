# Backend migration off Supabase: review of PR #2576 and rollout plan

> Companion to ADR-009 (backend platform) and ADR-010 (port gateway), which live on PR #2576 until slice S1 lands. This document does not re-decide anything in ADR-009; it records a reviewer's inventory, findings and a rollout/gating plan around that work. Epic: #1496.

- Author: KC Backend (architect and reviewer role). Implementer of the move: Nave's Claude Code session on PR #2576.
- Date: 2026-11-23 (Asia/Jerusalem).
- Sources: `KarmaCummunity/KC` `dev` at `77ae2cb8` (2026-11-23 22:47 IST), PR branch `claude/admiring-wozniak-zrj5ue` at `cd2cfeea` (2026-11-23 22:54 IST), and read-only SQL on **kc-dev** (`enbqriuxvvuontiwslun`). **kc-prod was not touched.**

Legend: **[V]** = verified by me from code, git, GitHub or kc-dev SQL. **[A]** = assumption or inference, to confirm. **[PR]** = claimed in PR #2576's body or ADR-009 and not re-run by me.

---

## 0. TL;DR

1. **PR #2576 is not a draft to rescue. It is the migration itself.** It already holds the decision (ADR-009 and ADR-010 exist only on the branch), the API foundation, the identity bridge, a PostgREST-compatible engine, a generic port gateway serving 76 to 78 application ports, a mobile `viaApi` router, and 4 of 20 Edge Functions ported natively. It has 0 commits behind `dev`, is MERGEABLE, and nothing in it is deployed or switched on. **Verdict: keep it as the implementation vehicle, but land it into `dev` in 4 slices instead of one 26k-line merge. Server-only slices go first, and the mobile wiring slice goes after the store release cut.** Do not close it. Do not start a parallel implementation.
2. **The PM already chose a modular monolith** (one NestJS app with a module per bounded context and one Postgres) on **Google Cloud** (ADR-009, PM chat 2026-11-21), and rejected service-per-context. This plan follows that. "Microservices" here means modules with enforced boundaries that can be split out later. Nave should confirm (Q1).
3. **Supabase surface is large and mostly inside the database.** kc-dev has 170 app tables (all RLS on), 179 policies, 727 SQL functions, 212 triggers, 50 active pg_cron jobs, pg_net used by 4 functions, and broadcast-only realtime through 5 trigger functions. The client has 228 distinct RPCs and 63 tables called directly. The hard parts are **realtime, media and auth**, not the CRUD.
4. **Gaps I found that the branch does not track yet**, all fixable and none urgent for launch:
   - (a) the "API door" ratchet misses direct `supabase.channel(...)` (1 hook), direct `storage.from(...)` uploads and URLs (6 mobile files), and image-transform URLs;
   - (b) the app has no force-update or minimum-version gate, and every store build shipped from now on will hard-depend on Supabase until it is forced off (ADR-009 itself says the gate is a prerequisite for phase 10);
   - (c) the manifest fetch in `createPortRouter` has no timeout, and the first data call waits for it;
   - (d) a server manifest moves 100% of users at once, so there is no canary or percentage rollout;
   - (e) the API base URL baked into a store build must be a stable domain KC owns, not a Cloud Run URL.
5. **First step (≤2 weeks, zero launch impact, no infra spend):** land ADR-009/010 plus this plan into `dev` (docs only), and widen the door ratchet so the inventory is complete. Then land the server-only slice (`apps/api` and `@kc/infrastructure-api` with its CI lane, no mobile files). Then add a parity lane (API vs PostgREST, same rows, on the Supabase local stack). Infra (GCP project and billing, #2584) needs KC/Nave go-ahead.

---

## 1. Review of PR #2576

Link: https://github.com/KarmaCummunity/KC/pull/2576. Title: "feat(infra): move the backend off Supabase to an owned NestJS API (long-lived branch)".

### 1.1 State [V]

| Item | Value |
|---|---|
| State | Open, **draft on purpose** (PM instruction, 2026-11-21: one branch, merged into `dev` once at the end) |
| Base / head | `dev` ← `claude/admiring-wozniak-zrj5ue` |
| Size | 28 commits, 259 files, +26,423 / −295 |
| Split of the diff | `app/apps/api` + `app/packages/infrastructure-api`: 174 files, +23,398 (new code). `app/apps/mobile`: 49 files, +356/−129. `packages/application` + `infrastructure-supabase`: 24 files, +487/−152. Plus docs, `app/scripts/check-*.mjs`, configs |
| Sync with dev | **0 commits behind `dev`**. Last merge of `dev` was `cd2cfeea` at 2026-11-23 22:54 IST. GitHub: `mergeable=MERGEABLE`, `mergeStateStatus=BLOCKED` (draft plus required checks) |
| CI | Draft, so the `CI gate` fails by design without running lanes (author comment, 2026-11-21). On the current head: GitGuardian pass, Snyk pass (8 tests), CodeRabbit skipped, other jobs pending or skipping. **No full CI run has happened on this branch** [V from checks list; PR body says lanes are run locally] |
| Reviews | None. One comment (by navesarussi, explaining the red draft gate) |
| Labels | `area:docs`, `database`, `area:mobile`, `area:social`, `agent:claude` |
| Linked issues | Epic #1496. Closes #2575 (ADR), #2577 (skeleton), #2580 (pg/redis/readiness/image), #2582 (identity bridge). Person steps: #2584 (GCP project with billing and more, **P0, `human`**) |
| Activity | Commits 2026-11-21 14:05–16:11 IST and 2026-11-23 22:25–22:54 IST (the session is active right now) |

### 1.2 What is already ported vs. not (per capability)

| Capability | On the branch | Not yet | Evidence |
|---|---|---|---|
| API foundation (NestJS on Fastify, config, errors, request ids, health/readiness, pg pool, Redis, Dockerfile) | Done | Container image never built (no Docker). Not deployed | [V] files under `app/apps/api/src/platform/*`, `Dockerfile`. [PR] image unbuilt |
| Identity bridge | Done: verifies Supabase access tokens against `<issuer>/.well-known/jwks.json`, ES256/RS256 only. Each request runs in one transaction with `set_config('role'…)`, `request.jwt.claims`, `search_path`, so `auth.uid()` and RLS behave as through PostgREST | CI parity against real PostgREST | [V] `platform/identity/*`, `platform/database/identityDatabase.ts`. [V] kc-dev JWKS publishes 1 ES256 key, so it works for dev. **kc-prod signing keys not checked (rule: don't touch prod) → Q5** |
| Data access (tables and RPCs) | Code done, **not switched on**. PostgREST-compatible SQL engine (`platform/postgrest`, ~1.1k LOC) runs the unchanged Supabase adapters on the server. Generic gateway `POST /v1/ports/<port>/<method>` plus manifest `GET /v1/ports`. Per-method access `public`/`member`/`not_served`. Argument shape checks, dates on the wire, Redis rate limit (fails open), visitor cache, CORS | Contract suites for ~70 of 76–78 ports (only the all-ports smoke covers them). `post.republish` is `not_served` (waits for Storage). Turning on `EXPO_PUBLIC_KC_API_URL` needs a deployed API | [V] `modules/hostedAdapters/ports/*`, `posts.ts:158 republish: 'not_served'`. [PR] 76 ports / 367 methods (body) vs 78 / 372 (ADR status). Counts differ between the two docs |
| Mobile wiring | `viaApi(name, adapter)` wraps every data adapter. With the env var unset it returns the adapter itself, so it is a true no-op | Flag never set in any build | [V] `apps/mobile/src/services/backend/apiBackend.ts` |
| Edge Functions (phase 8) | **4 of 20 ported** as native modules behind a generic function registry: `validate-donation-link`, `public-research-submit`, `translate`, `extract-external-post` (posts import, 2026-11-23). One Gemini client (`platform/ai`). A service-role DB path for server modules | 16 left: `identity-verification-session` (the only one left that the app calls), `identity-verification-webhook`, `payments-webhook`, `revenuecat-webhook`, `whatsapp-webhook`, `whatsapp-sender`, `dispatch-notification`, `process-post-media`, `backfill-image-thumbs`, `strip-exif`, `reconcile-storage-orphans`, `embed-worker`, `match-rerank`, `purge-deleted-accounts`, `rotate-research-salt`, `subscriptions-charger`. Webhooks as routes. Schedules | [V] `modules/hostedFunctions/hostedFunctionSet.ts` |
| Realtime (phase 6) | Not started | All of it (see 2.5) | [V] ratchet lists 5 realtime adapters as phase 6 |
| Storage / media (phase 7) | Not started | All of it | [V] |
| Background work: pg_cron, pg_net, Vault (phase 8) | Not started (apart from the functions above) | 50 cron jobs, 4 pg_net callers | [V] kc-dev |
| Own identity (phase 9) | Not started. `/session` module exists on the API | Everything. Needs email provider and Apple/Google config (#2584) | [V] `modules/session` exists. Scope [A] |
| Database move to Cloud SQL (phase 10) | Not started. Baseline harness runs the migration chain on plain PG17 | Everything | [PR] |
| Guards | `check-api-door.mjs` ratchet in `pnpm lint:arch` (8 known bypasses), arch guard scans `apps/api`, port-args generator with a staleness test | **Ratchet blind spots** (1.4 R3) | [V] |

"Posts import done, 746 tests green": the posts import commit is verified (`3d3953c4`, 2026-11-23 22:49 IST). The 746 test count is **not verified** by me. The PR body gives 502 for `@kc/api`.

### 1.3 Reusable as-is (strong parts)

- **Strangler-by-port design** (ADR-010). The app reaches Supabase only through `@kc/application` ports, so a second adapter is the designed extension point. The server decides per method (manifest) and fallback goes to the in-place adapter. A routed call that fails does **not** fall back, so a write can't run twice [V `portRouter.ts`].
- **Identity bridge with no SQL rewrite.** RLS stays the authority. This is the right call for "no user-facing regressions".
- **Generic function registry**: Edge Functions port one at a time and share `@kc/domain` instead of Deno mirrors.
- **Baseline harness on plain PostgreSQL 17** (portability guard) and the all-ports, all-methods smoke on the real schema.

### 1.4 Risks and architectural concerns (reviewer findings)

| # | Finding | Severity | Suggestion |
|---|---|---|---|
| R1 | **Single 26k-line merge at the end** contradicts "no big-bang". It is impossible to review meaningfully, and it touches code-owned paths and 49 mobile files during the store launch | High (process) | Land in 4 slices (1.5). Each one is reviewable and reversible. Server-only first |
| R2 | **No force-update / minimum-version gate in the app** [V: no match for min-version or force-update patterns in `apps/mobile`]. Every build shipped to stores now calls Supabase directly forever. ADR-009 itself says such builds must be forced off before phase 10 | High (long-term), zero for launch | Build the gate early and ship it in a store build soon (product decision, Q3). It is cheap now and very expensive later |
| R3 | **Door ratchet blind spots**: it catches `.from/.rpc` and un-wrapped adapters, but not (a) `supabase.channel(...)` in `hooks/useNotificationInboxBadge.ts`, (b) `storage.from(...)` in `avatarUpload`, `storageObjectUpload`, `listingImageUpload`, `chatMediaUrl`, `abandonedUploads`, `usePostShare`, (c) Supabase image-transform and public URLs built in `lib/imageUrl.ts` (7 sites), (d) `supabase.auth` used by the API transport for tokens. "8 bypasses left" understates the remaining surface | Medium | Extend the scanner to `.channel(`, `storage.from(`, `functions.invoke(`, `.auth.`, `/storage/v1/` URL builders. Seed `KNOWN` with today's list (phases 6/7/9) |
| R4 | **Media URLs are built on the client from bucket and key** (`buildSupabaseImageTransformUrl`). Installed builds will keep requesting `*.supabase.co/storage/v1/...` | High for phase 7 | Phase 7 needs either a server-supplied URL field (ship before launch-plus-N builds age out) or keeping Supabase Storage read-only until old builds are gated off |
| R5 | **Manifest fetch has no timeout**, and the first data call waits for it (`createPortRouter.load`). If the API host hangs, cold start hangs until the OS times out | Medium (only when the flag is on) | Add an AbortSignal timeout (for example 1.5–2 s) and treat a timeout as "nothing served" |
| R6 | **All-or-nothing rollout per method**: the manifest is global, so there is no canary, percentage or per-user rollout | Medium | Let the manifest take a rollout percentage per port, bucketed by a stable hash of the user id, plus an `x-kc-app-version` minimum. The kill switch stays server-side |
| R7 | **A custom PostgREST dialect engine** is a long-lived compatibility layer. It refuses unknown dialect loudly, which is good, and requests come from server-side adapters rather than clients, which keeps the injection surface small. It is still 1.1k LOC of SQL building that must be deleted later (phase 11) | Medium | Keep it. Add a fuzz/property test of filter grammar to SQL. Make phase 11's "delete engine" exit criterion explicit per context |
| R8 | **Two bills and cross-cloud latency** (API on GCP, DB on Supabase) during phases 3–9. Every port call adds API→Supabase Postgres RTT. The Supabase project region needs to be known | Medium | Pick the GCP region nearest the Supabase project region (Q6). Measure p95 on dev before any user is routed |
| R9 | **DB login for the API**: it needs a Postgres role that can `SET ROLE authenticated / anon / service_role` through Supavisor in transaction mode. Pool size competes with PostgREST's | Medium | Dedicated login role, transaction pooler, explicit `max` pool. Document it in `docs/SSOT/ENVIRONMENTS.md` (names only) |
| R10 | **Realtime is DB-driven broadcast** (`realtime.send` from 5 trigger functions, 6 policies on `realtime.messages`). Moving it before the DB moves needs an outbox→worker→Redis→WebSocket path | Medium-High | Use the existing `kc_private.outbox_events` (or a new `realtime_outbox`) drained by the API worker. Dual-publish during the transition |
| R11 | **Drift on kc-dev**: 23 Edge Functions deployed vs 20 in the repo. `delete-account`, `receipts-issuer`, `whatsapp-intake-worker` are deployed but have no source on `dev` (they are only referenced in docs/workflows) | Low | Confirm they are retired and undeploy them on dev (owner action). Check prod the same way (owner) |
| R12 | Port counts disagree (76/367 in the PR body, 78/372 in ADR status). The `post.republish` method returns 501 if a manifest ever lists it | Low | Generate counts from the manifest in CI. Fine as is otherwise |

### 1.5 Recommendation: keep, and land in 4 slices

Do not close. Do not split into a new PR set by hand while the session is active. Ask the implementer session to cut these **stacked PRs into `dev`** from the branch, in this order. Each is reversible by revert, and none changes runtime behavior until a build sets `EXPO_PUBLIC_KC_API_URL`:

1. **S1 docs**: ADR-009, ADR-010, decision-log entries, this plan. Zero risk.
2. **S2 server**: `app/apps/api`, `app/packages/infrastructure-api`, `apps/api` CI lane, baseline harness hook, `check-api-door.mjs` (widened per R3). No `apps/mobile` files. Low risk: CI only.
3. **S3 ports**: new application ports for the 6 port-less adapters plus the 3 direct reads (`packages/application`, `infrastructure-supabase`). Behavior-preserving refactor, covered by the existing mobile suites. Medium-low risk. **Land after the store release candidate is cut.**
4. **S4 mobile wiring**: `viaApi` in composition roots, `apiBackend.ts`, with fixes R5/R6. A no-op while the env var is unset. **Land after launch stabilises.**

The branch then keeps only in-flight work (phase 8 functions and so on), and each later function or port ships as its own small PR into `dev`.

---

## 2. Supabase usage inventory

### 2.1 Client side (`dev` @ `77ae2cb8`, `app/`, excluding tests) [V]

| Capability | Numbers | Where |
|---|---|---|
| RPC | **248 `.rpc(` call sites, 228 distinct RPC names** | Almost all in `packages/infrastructure-supabase` |
| Tables (direct `.from('table')`) | **63 distinct tables**. Top: `users` 24, `posts` 20, `post_handoffs` 13, `post_private_locations` 6, `post_media` 5, `follows` 5, `donation_links` 5 | Same |
| Auth | One adapter `SupabaseAuthService` (17 `auth.*` calls): email/password sign-up/in, Google ID token (native) and OAuth, Apple, OTP verify/resend, reset password, `exchangeCodeForSession`, `updateUser`, sign-out, session restore | `infrastructure-supabase/src/auth`, wired in `apps/mobile/src/services/authComposition.ts` |
| Storage | Buckets used by code: `post-images`, `avatars`, `chat-media` (private, signed URLs), `listing-images` (read path for older rows), `post-photo-derived-private` (referenced in `lib/privatePhotoSource.ts`; **no such bucket on kc-dev** → Q8). Direct uploads and URLs from 6 mobile files. Image transform URLs in `lib/imageUrl.ts` | `apps/mobile/src/services/*Upload*.ts`, `lib/imageUrl.ts`, `infrastructure-supabase/src/posts/postMedia*` |
| Edge Functions called by the app | **5**: `validate-donation-link`, `translate`, `identity-verification-session`, `extract-external-post`, `public-research-submit` (4 already ported on #2576) | `functions.invoke` in `infrastructure-supabase` |
| Realtime | 6 adapters: `SupabaseChatRealtime`, `SupabaseChatV2Realtime`, `SupabaseFeedRealtime`, `SupabaseUserRealtime`, `SupabaseOnlinePresence` (presence), `SupabaseRidesRealtime`. Plus **1 direct private channel** in `hooks/useNotificationInboxBadge.ts`. Shared helper `realtime/exactTopicChannel.ts` | |
| Repo | `supabase/migrations`: **81 files** (`0001_baseline.sql` … `0094_verified_edge_caller.sql`, plus `archive/`, `baseline/`). `supabase/functions`: **20 functions** plus `_shared` | |

### 2.2 Database (kc-dev, read-only SQL, 2026-11-23) [V]

App schemas = `public`, `kc_private`, `kc_access`, `ops`, `audit`, `billing`, `integrations`.

| Item | kc-dev |
|---|---|
| Tables | 170 in app schemas (public 89, kc_private 38, billing 18, integrations 15, audit 5, ops 5). **All 170 have RLS enabled** |
| RLS policies | **179, all in `public`**. Non-public app schemas have RLS on with no policies, so they deny client roles and are reached only through `SECURITY DEFINER` functions. Plus 13 on `storage.objects`/buckets and **6 on `realtime.messages`** (private channel auth) |
| SQL functions | **727** in app schemas (`kc_private` 396, `public` 297, `kc_access` 30, `ops` 4). In `public`, **266 of 297 are `SECURITY DEFINER`**, all with a pinned `search_path` (0 without). 8 `public` functions executable by `anon`. 59 functions reference `auth.uid()`, 0 reference `auth.jwt()` |
| Triggers | **212** in app schemas, plus `auth.users.on_auth_user_created` and `on_auth_user_verified` (profile bootstrap, tied to Supabase Auth) |
| Auth | 222 users. Providers: email, google, apple. **11 FKs reference `auth.users`**. JWKS publishes 1 ES256 key |
| pg_cron | **50 jobs, all active**, all of the form `select kc_private.job_run('<name>')` with a per-job `statement_timeout` (registry `kc_private.scheduled_jobs`, history `ops.job_runs`). Frequencies range from every 30 s (`chat_system_messages`) and every minute (`audit_consume`, `chat_moderation`, `community_stats_refresh`, `karma_consume`, `moderation_consume`, `post_media_process`) to daily retention and reconcile jobs |
| pg_net | Used only by `kc_private.invoke_edge_function` (plus the readiness probe). It is called from **4 functions**: `edge_function_kick` (debounced via `kc_private.edge_function_kicks`), `push_dispatch_tick`, `whatsapp_send_tick`, `post_media_process_tick`. That is the DB → Edge Function path for push, WhatsApp and media |
| DB webhooks | None found as `supabase_functions` hooks (schema absent). Webhook-style work goes through pg_net above |
| Realtime | `supabase_realtime` publication has **0 tables**, so there is **no `postgres_changes`**. Everything is **Broadcast** through `kc_private.broadcast` (`realtime.send`), called by 5 trigger functions: `chat_broadcast_changes`, `user_account_broadcast_gate`, `notifications_broadcast_badge`, `user_stats_broadcast`, `posts_feed_new_post_broadcast`. Outbox table: `kc_private.outbox_events` |
| Storage | 4 buckets: `avatars` (public), `chat-media` (private), `listing-images` (public), `post-images` (public). 233 objects (small, dev) |
| Extensions | btree_gin, btree_gist, pg_cron, pg_net, pg_stat_statements, pg_trgm, pgcrypto, plpgsql, postgis 3.3.7, supabase_vault, uuid-ossp, vector 0.8.2 |
| Edge Functions deployed | 23 (repo has 20; see R11). `verify_jwt=false` for 4 webhooks: `identity-verification-webhook`, `revenuecat-webhook`, `payments-webhook`, `whatsapp-webhook` |

**RLS reliance:** total. The client talks to tables and functions as `authenticated`/`anon`, and correctness and privacy depend on the 179 policies plus definer functions. Any API that does not run "as the caller" would have to re-implement that. That is why #2576's identity bridge is the right foundation.

ADR-009's counts (159 tables / 731 functions / 201 policies / 200 triggers, counted from migrations) are close to but not equal to live kc-dev (170 / 727 / 179 / 212). The difference is expected: different counting basis, and ADR counts are from 2026-11-21 [A].

---

## 3. Target architecture (aligned with ADR-009; additions marked ➕)

### 3.1 Shape

**Modular monolith first, services later by evidence.** One NestJS codebase with two process types (`api` for HTTP/WebSocket, `worker` for queues and schedules) and one PostgreSQL primary. Modules map 1:1 to bounded contexts, with boundaries enforced by lint (already on the branch: arch guard scans `apps/api`). ➕ A module may be extracted into its own deployable only when (a) a load test shows it needs independent scaling, or (b) it has a different security or compliance boundary (payments/billing is the likely first candidate).

### 3.2 Service (module) boundaries and data ownership

| Module | Owns (schemas/tables, indicative) | Notes |
|---|---|---|
| `identity` | `auth.*` today → own `identity` schema in phase 9; `user_account`, `user_devices`, `user_consents` | Tokens, sessions, providers, account deletion |
| `people` | `users`, `user_private`, `user_stats`, `follows`, `follow_requests`, `blocks` | Profile and social graph |
| `posts` | `posts`, `post_*` detail tables, `post_media`, `saved_posts`, `post_reactions`, `post_comments`, series | Includes import (done) |
| `feed` | `feed_*`, `content_translations` (with `translation`), search | Read-heavy. Redis cache |
| `handoffs` and `rides` | `post_handoffs`, `handoff_booking_details`, `ride_*`, `road_junctions`, `streets`, `cities` | Geo (postgis) |
| `chat` | `chats`, `chat_members`, `messages`, `message_reactions` | Realtime heavy |
| `notifications` | notifications tables, push dispatch, WhatsApp sender | Worker heavy |
| `organizations`, `volunteering`, `knowledge` | `organizations`, `org_*`, `knowledge_*`, `surveys` | |
| `finance` | `billing.*`, donation links, payments/RevenueCat webhooks, standing orders | ➕ First extraction candidate (compliance, webhooks) |
| `moderation` and `admin` | `reports`, `moderation_queue`, `admin_role_grants`, `audit.*` | |
| `media` | buckets → GCS objects, variants, EXIF, video | Phase 7 |
| `research`, `matching`, `karma` | `kc_private.embedding_jobs`, `karma_ledger`, match tables | Worker jobs |

Rule: a module writes only its own tables. It reads others' data through their module's use cases, or through read-only SQL views owned by the target module. Until phase 11, existing `SECURITY DEFINER` functions stay the "module API" inside the DB.

### 3.3 API contracts

- **App ↔ API**: the typed contract is the `@kc/application` port interfaces (ADR-010): `POST /v1/ports/<port>/<method>` plus `GET /v1/ports` manifest. This is effectively typed RPC, not REST. ➕ Two additions: (1) publish a generated **OpenAPI 3.1** document from the port catalog plus argument shapes (already generated for validation) for docs, external tooling and contract diffs in CI; (2) a **breaking-change check** in CI: removing a method or changing an argument shape fails unless the method is versioned (`<method>.v2`), because store builds live for months.
- **Webhooks and partners**: plain REST under `/v1/webhooks/<provider>` with signature verification, replacing the 4 `verify_jwt=false` Edge Functions.
- **Errors**: one error body and typed error codec (on the branch).

### 3.4 Auth strategy (keep Supabase JWTs valid during the transition)

1. **Phases 3–8: Supabase Auth stays the issuer.** The API verifies Supabase access tokens via JWKS (ES256), with `iss` checked exactly. Tokens are refreshed by supabase-js on the client. The API runs SQL as `authenticated` with the same claims, so `auth.uid()` is unchanged. Prerequisite: **kc-prod must use asymmetric signing keys** (kc-dev does) → Q5.
2. **Phase 9: KC issues tokens.** The `identity` module signs ES256 tokens with **the same claim shape** (`sub` = existing `auth.users.id`, `role`, `aud`) so RLS and `auth.uid()` keep working. **The API accepts both issuers** (Supabase JWKS plus KC JWKS) during a dual-issuer window. The app switches issuer behind a flag at next sign-in or refresh: exchange the Supabase refresh token at `/v1/session/exchange` for a KC session, with no re-login. Users move with bcrypt hashes and provider identities (google/apple `sub`), so nobody resets a password. The 2 triggers on `auth.users` and the 11 FKs to `auth.users` move with the table.
3. **Phase 10+**: Supabase JWKS is removed from the accepted list once the min-version gate (R2) has aged out old builds.

### 3.5 Messaging and events

- **Transactional outbox** in Postgres (exists: `kc_private.outbox_events`). Domain changes write outbox rows in the same transaction. The `worker` drains with `FOR UPDATE SKIP LOCKED` into **BullMQ (Redis)** queues: push, WhatsApp, media, embeddings, matching, moderation, karma.
- **Realtime**: WebSocket gateway in `api`, fan-out over Redis pub/sub, same topics and audience rules as ADR-003. ➕ Transition: the 5 broadcast trigger functions also write a `realtime` outbox row (dual-publish). The client subscribes through a `RealtimePort` with two adapters (Supabase channel and KC WS), switched per topic family by flag.
- **Schedules**: Cloud Scheduler → `worker` HTTP job endpoints replace the pg_cron jobs that call out (pg_net) or do heavy work. Pure-SQL maintenance jobs (retention, partitions) may stay on pg_cron (Cloud SQL supports it) [A: Cloud SQL pg_cron support should be confirmed when provisioning].

### 3.6 Deployment and observability

- GCP (PM decision): Cloud Run (`api` min 0 in dev, `worker` min 0/1), Artifact Registry, Secret Manager, Workload Identity Federation for CI, Terraform in `infra/gcp/`, Memorystore Redis (smallest tier), and Cloud SQL PG17 only at phase 10. During phases 3–9 the region is the one nearest the Supabase project; it moves to `me-west1` with the DB.
- ➕ A **stable API domain** (for example `api.<kc-domain>`) from day one, because it is baked into store builds (R2/R5).
- Observability: Sentry (already used) for api and worker, structured JSON logs with request id and user id hash, OpenTelemetry traces to Cloud Trace, Cloud Monitoring SLO alerts (availability, p95 per port, queue lag). The existing `ops` health registry is extended with queue and cron health. ➕ A **parity dashboard** per port: API vs Supabase error rate and p95 during dual-run.

### 3.7 Cost notes (all need KC/Nave go-ahead; numbers are [A], not quotes)

- Dev while flags are off: Cloud Run at scale-to-zero plus Artifact Registry plus Secret Manager are close to free. **Memorystore Redis is the first fixed monthly cost** (smallest Basic tier, on the order of tens of USD/month [A]). It can be deferred by running the dev API without Redis: the limiter fails open, and the cache and queues must be optional.
- Budget alert from day one (ADR-009).
- Overlap: Supabase stays paid through phase 10, so double billing is the price of zero-regression.
- Prod sizing (Cloud SQL HA, replicas, min instances) is decided from k6 results in phase 10, not guessed now.
- **Nothing is provisioned without an explicit go-ahead** (#2584 is the place).

---

## 4. Incremental strangler migration plan

### 4.1 Guardrails (apply to every step)

- PRs into **`dev` only**. Never `main`, never kc-prod, never deploy-prod without Nave (AGENTS.md).
- **Launch freeze**: until the store builds are approved and stable, no change under `apps/mobile` from this program except the min-version gate (if approved). Server-only and docs work continues.
- Every switch is a **server-side flag** (manifest) with the Supabase adapter still in the build. Rollback means removing the port from the manifest, effective within the manifest TTL (5 min) with no app release.
- ➕ Rollout per port: **dev 100% → prod internal testers → 1% → 10% → 50% → 100%**, with ≥24h at each prod stage (needs R6).
- Nothing is deleted from Supabase until its replacement has run at 100% on prod for **one full release cycle** and the min-version gate excludes builds that still need it.

### 4.2 Ordering (lowest risk first), mapped to #2576's phases

| Order | Step | ADR-009 phase | Owner | Dual-run | Cut-over criterion | Rollback |
|---|---|---|---|---|---|---|
| 0 | Docs + guard completeness (ratchet R3), min-version gate (R2, product OK) | 4/5 prep | KC Backend (docs, guard) / implementer | n/a | Ratchet lists every Supabase touchpoint | Revert |
| 1 | Land server slice S2 into dev. CI lane builds the image | 1 | implementer | n/a | CI lane green, image answers `/health` | Revert |
| 2 | Parity lane: API vs PostgREST, same rows per user, on the Supabase local stack | 3 | implementer, reviewed by KC Backend | CI | 6 contract ports and an RLS sample equal for 2 users plus anon | Revert |
| 3 | GCP dev environment (needs go-ahead and billing) | 2 | Nave (project), implementer (Terraform) | n/a | Merge to dev deploys. Smoke reads `/health` and `/ready` | Destroy stack |
| 4 | Land S3 (ports) and S4 (mobile wiring) after launch stabilises. Dev builds set `EXPO_PUBLIC_KC_API_URL` | 5 | implementer | Dev only | 2-user E2E journeys pass on flag on and off | Unset env / empty manifest |
| 5 | Serve **read-only public ports** first (legal docs, cities/streets, worlds, item subcategories, app flags, public feed) | 5 | implementer | Shadow reads: sample 1% of Supabase-served reads, also call the API, compare hashes, log the diff (no user impact) | 7 days on dev with zero diffs and API p95 ≤ Supabase p95 + 50 ms. Then prod rollout ladder | Manifest |
| 6 | Member reads (profile, follow, saved, my posts), then **writes** (posts, comments, reactions), then handoffs and rides, then chat, then notifications, then orgs and finance, then admin | 5 | implementer | Writes: no shadow (double write). Canary ladder only, with idempotency keys on create methods | Contract suite for the port passes through the gateway. Error-rate delta < 0.1 pp at each ladder stage | Manifest |
| 7 | Remaining 16 Edge Functions: app-called first (`identity-verification-session`), then webhooks as `/v1/webhooks/*` (provider dashboards re-pointed one at a time; old function kept live), then workers (push, WhatsApp, media, embed, match) fed by outbox → BullMQ, replacing `invoke_edge_function` callers | 8 | implementer | Webhooks: provider sends to new URL, old kept as fallback. Workers: run both with an idempotency key, then disable the old pg_net kick | Queue lag SLO met 7 days. No duplicate sends (dedupe table) | Re-point webhook / re-enable kick |
| 8 | pg_cron jobs: those that call pg_net or are heavy move to Cloud Scheduler → worker. Pure SQL retention stays | 8 | implementer | Run new and old with a job lock (`ops.job_runs`) | Job health green 7 days | Re-enable cron job |
| 9 | Realtime: dual-publish (Supabase broadcast plus KC WS) per topic family: badge/user stats → feed → chat → presence | 6 | implementer | Both publish. Client flag picks the subscriber | Delivery lag p95 and reconnect tests equal. No missed-message reports on dev | Flag |
| 10 | Media: new uploads to GCS via signed URLs, server returns full URLs (fixes R4), copy existing objects with checksum, keep Supabase Storage read-only | 7 | implementer | Reads from both (URL from server) | Checksums equal. k6 media budget met | Flag / URL source |
| 11 | Own identity with dual issuer (3.4) | 9 | implementer (needs #2584 items) | Both issuers accepted | All sign-in methods pass E2E. Token exchange success > 99.9% | Accept-only-Supabase flag |
| 12 | DB move to Cloud SQL, 2 rehearsals on dev, prod window | 10 | implementer plus Nave go/no-go | n/a | Per-table counts and checksums. E2E plus k6 | Pre-copy backup. Keep Supabase 30 days |
| 13 | Hosted adapters → native modules. Delete the PostgREST engine | 11 | continuous | Contract suites | Engine deleted | Revert |

### 4.3 First 3 concrete PR-sized steps into `dev` (deliverable within about 2 weeks, zero launch impact, no infra spend)

**Step 1 — `docs(architecture): backend migration plan and review` (docs-only, KC Backend), 1–2 days.**
- Add `docs/architecture/backend-migration-plan.md` (this plan, condensed) and a row in `docs/architecture/README.md`. Reference ADR-009/010 on the branch. ➕ Better: the implementer lands ADR-009/010 to `dev` as slice S1 in the same week, and this doc links them.
- Acceptance: docs only, CI `static` lane green, one opened-by label.

**Step 2 — `chore(infra): widen the API-door ratchet to every Supabase touchpoint` (implementer on the branch or as a separate small PR; tooling only), 1–2 days.**
- `app/scripts/check-api-door.mjs`: also flag `.channel(`, `storage.from(`, `functions.invoke(`, `.auth.` on a client, and Supabase storage URL builders in `apps/mobile`. Seed `KNOWN` with today's findings tagged phase 6/7/9. Add a unit test per pattern.
- Acceptance: `pnpm lint:arch` green on dev with the seeded list. A new direct `supabase.channel(` in a test fixture fails.
- If it lands before S2, it lives in `app/scripts/` with no dependency on `apps/api`.

**Step 3 — `feat(infra): land the API server slice (S2) with its CI lane` (implementer; cut from #2576), about 1 week including review.**
- Contents: `app/apps/api/**`, `app/packages/infrastructure-api/**`, workspace/turbo wiring, a CI lane that builds the image, runs `@kc/api` tests against a Postgres 17 service container plus Redis, and runs the all-ports smoke on the baseline schema. **No `apps/mobile` changes.** Include fix R5 (manifest fetch timeout) in `infrastructure-api`.
- Acceptance: lane green on the PR, image `/health` and `/ready` pass in CI, code-owner review (Nave) on touched code-owned paths. Revertable in one commit.
- Follow-up in the same 2-week window if review capacity allows: the **parity lane** (phase 3 exit), API vs PostgREST same rows for 2 users plus anon on the Supabase local stack.

Explicitly **not** in the first 2 weeks: GCP provisioning (needs go-ahead), any mobile change other than the optional min-version gate, any manifest serving to real users.

---

## 5. Open questions for KC / Nave

1. **Shape**: ADR-009 records the PM choosing a **modular monolith** and withdrawing service-per-context. The brief to KC Backend said "microservices". Confirm the modular monolith, with extraction by evidence later?
2. **Merge strategy for #2576**: OK to land it in 4 slices (docs → server → ports → mobile wiring) instead of one final merge? This changes the PM instruction of 2026-11-21.
3. **Force-update / minimum-version gate**: approve building it now and shipping it in an early post-launch store build? Without it, every build shipped now hard-depends on Supabase.
4. **Infra go-ahead**: GCP project with billing (#2584), plus monthly budget ceiling for dev (Redis is the first fixed cost).
5. **kc-prod JWT signing**: does kc-prod use asymmetric (ES256) signing keys like kc-dev? The API only accepts ES256/RS256. Owner check, since I did not touch prod.
6. **Supabase project region(s)** for kc-dev and kc-prod, to choose the GCP region for phases 3–9.
7. **Stable API domain** to bake into builds (for example `api.<domain>`): which domain, and who controls DNS?
8. **`post-photo-derived-private`** bucket is referenced in `apps/mobile/src/lib/privatePhotoSource.ts` but does not exist on kc-dev. Planned, or a leftover?
9. **Stale deployed functions on kc-dev** (`delete-account`, `receipts-issuer`, `whatsapp-intake-worker`): retired? OK to undeploy (owner action)?
10. **Who owns what**: confirm the Claude Code session is the sole implementer and KC Backend reviews, owns docs and guard PRs, and runs parity and rollout gates.

---
