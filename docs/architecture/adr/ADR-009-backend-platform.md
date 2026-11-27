# ADR-009 — Backend platform: an owned NestJS API on Google Cloud, off Supabase in phases

- **Status:** Accepted (PM, chat, 2026-11-21) · engineering decision `{{ENG:backend-platform-off-supabase}}` · supersedes `D-2`
- **Issue:** epic KC#1496 · this document KC#2575
- **Related:** [ADR-002](./ADR-002-data-layer.md) (data layer, stays in force for every context not yet moved), [ADR-003](./ADR-003-realtime.md) (realtime topics and auth), `D-204` (port contract suites), [`target.md`](../target.md) §4

## Context

KC runs entirely on Supabase (`D-2`): hosted Postgres, Auth, Storage, Realtime and Edge Functions. The app calls the database directly through PostgREST. Counted on `dev` on 2026-11-21:

| Surface | Size |
|---|---|
| Tables / SQL functions / RLS policies / triggers | 159 / 731 / 201 / 200 |
| Distinct RPC calls from the app | 229 |
| Edge Functions (Deno) | 20 |
| Application ports implemented by `@kc/infrastructure-supabase` | 54 |

The PM's goal is a backend KC owns, able to carry a social network with photos and video for many concurrent users without slowing down. Four properties of the current shape work against that:

1. **The database schema is the public API.** Every installed app build calls tables and functions by name. A store build cannot be changed after release, so every schema change must stay compatible with every build still in use. A versioned API removes that coupling.
2. **Business logic runs inside the primary database.** 731 functions execute on the one machine that is hardest to scale. A stateless API tier scales horizontally and leaves the database to store and query.
3. **Server code cannot share the domain packages.** Edge Functions run on Deno and mirror `@kc/domain` code instead of importing it (see ADR-008). A Node server imports `@kc/domain` and `@kc/application` directly.
4. **Media has no pipeline.** Storage serves the uploaded file; video (gap `G53`) needs transcoding, adaptive streaming and a CDN.

What makes the move feasible: the app reaches Supabase only through the ports of `@kc/application`, and shared contract suites already run against a fake and the Supabase adapter (`D-204`). A second adapter is the designed extension point.

## Decision

KC moves to a backend it owns, in phases, with the app working at every step.

| Choice | Decision (PM, 2026-11-21) |
|---|---|
| Cloud | **Google Cloud.** Final region `me-west1` (Tel Aviv), close to the users |
| Shape | **Modular monolith**: one NestJS application, one module per bounded context, one PostgreSQL primary |
| Budget | Smallest sizes while in development; launch sizing before the public launch. Sizes are configuration, not code |

### Components

| Concern | Today | Target |
|---|---|---|
| API | PostgREST, called by the app | NestJS (`app/apps/api`) on Cloud Run: stateless, autoscaled, versioned under `/v1`. The app's data access is one gateway route that serves the application ports ([ADR-010](./ADR-010-port-gateway.md)); webhooks and health are ordinary REST |
| Database | Supabase Postgres 17 | Cloud SQL for PostgreSQL 17 with the same extensions (`postgis`, `vector`, `pg_trgm`, `btree_gin`, `btree_gist`, `pg_cron`). `pg_net` and `supabase_vault` are not carried over: the API's workers and Secret Manager replace them |
| Identity | Supabase Auth | An `identity` module: Google and Apple ID-token sign-in, email and password, short-lived access tokens, rotating refresh tokens stored hashed |
| Authorization | RLS + `SECURITY DEFINER` RPCs | RLS stays the authority until the database move and stays as defense in depth after it; API guards are added on top |
| Realtime | Supabase Realtime | WebSocket gateway in the API, fanned out through Redis, same topics and audience rules as ADR-003 |
| Media | Supabase Storage | Cloud Storage + Cloud CDN, uploads go straight to the bucket with signed URLs, image variants and EXIF stripping in a worker, video transcoded to adaptive streams (`G53`) |
| Background work | Edge Functions + `pg_cron` + `pg_net` | A worker process of the same NestJS codebase with Redis-backed queues; Cloud Scheduler for timed jobs; `pg_cron` only for pure-SQL maintenance |
| Cache and limits | none | Redis: hot reads (feed, counters), rate limits, idempotency keys, queues, realtime fan-out |
| Secrets | Supabase dashboard + Vault | Secret Manager; CI authenticates with Workload Identity Federation, no long-lived keys |
| Infrastructure | dashboard settings | Terraform under `infra/gcp/`, one variable file per environment |
| Observability | Sentry + `ops` health registry | The same, plus structured request logs, traces and Cloud Monitoring alerts |

Default libraries (a phase's issue may replace one with evidence): Fastify adapter, `pg` (a typed query builder joins when native modules replace hosted adapters), BullMQ. The typed contract between the app and the API is the port interfaces of `@kc/application`, not a generated client (ADR-010).

### Placement in the monorepo

```
app/apps/api/                       second composition root (server); imports @kc/domain and @kc/application
  src/modules/<context>/            native modules: use case → repository, one folder per bounded context
  src/modules/hostedAdapters/       the Supabase adapters served through the gateway until a native module replaces them
  src/platform/                     config, logging, errors, database, redis, health, identity, ports (gateway), postgrest (engine)
app/packages/infrastructure-api/    the wire format and the generic remote port the app uses for every port
infra/gcp/                          Terraform
```

`@kc/domain` and `@kc/application` keep their rules (`AGENTS.md` §5). While the move is in flight the API hosts the adapters of `@kc/infrastructure-supabase` on its own SQL-backed client (ADR-010); it never opens a network client to Supabase. The mobile app never imports `apps/api`.

### How the move works: one database, two doors, then one

The alternative to a strangler is a second environment that only becomes usable when everything is ported; it would chase a codebase that changes many times a day. Instead the API is added **in front of the existing database** and takes over one port at a time:

1. The API connects to the current Postgres with its own role and runs every request in a transaction under the caller's identity (`set local role` plus the request claims), so `auth.uid()`, every RLS policy and every existing function behave exactly as they do through PostgREST. No SQL is rewritten to move a port.
2. Until KC has its own identity module, the API accepts the access token Supabase Auth issues, verified against the project's signing keys.
3. The app's composition root picks the adapter per port from a flag. A port moves when its contract suite passes through the API; switching it back is a flag change. The API serves a port by running its existing adapter on the server ([ADR-010](./ADR-010-port-gateway.md)), so moving a port needs no rewrite.
4. When no port, channel, bucket, function or sign-in uses Supabase, the project is only a Postgres host. The database then moves to Cloud SQL in one rehearsed step that clients do not see, because they only know the API.

During phases 1–9 the API runs in the Google Cloud region nearest to the Supabase project, to keep query latency low; it moves to `me-west1` together with the database.

## Phases

Each phase is one or more child issues of KC#1496, opened when its turn comes. A phase is done only when its exit criterion is proven by an automated check.

| # | Phase | Exit criterion |
|---|---|---|
| 1 | **API foundation.** `app/apps/api`: health and readiness, validated config, structured logs, typed error mapping, OpenAPI, tests; local Postgres + Redis with Docker Compose; container image; CI lane | The CI lane is green; the image answers `/health` against the local stack |
| 2 | **Google Cloud dev environment.** Terraform: Artifact Registry, Cloud Run, Secret Manager, Workload Identity Federation, budget alert; a deploy stage in **Deploy** | A merge to `dev` deploys the API and the deploy smoke test reads its health URL |
| 3 | **Identity bridge and data access.** Token verification, per-request identity in the transaction, connection pooling | An integration test reads an RLS-protected resource through the API and through PostgREST as two different users and gets the same rows |
| 4 | **Database portability guard.** Already in the repo: `scripts/run-baseline-tests.sh` applies the whole migration chain to plain PostgreSQL 17 through `supabase/baseline/local/supabase_shim.sql` and runs the DB suites. Left: confirm it is a required lane, and replace the three platform extensions (`pg_cron`, `pg_net`, Vault) in phases 8 and 10 | A migration that needs a Supabase-only feature fails the lane |
| 5 | **The API becomes the only door**, port by port (ADR-010): declare the port for the gateway with an access decision per method, pass its contract suite through the gateway (write the suite first if it has none), switch the app's composition root to the remote port behind the flag. Order: profile and follow → posts, feed and search → handoffs and rides → chat → notifications → organizations and finance → admin | `app/scripts/check-api-door.mjs` (in `pnpm lint:arch`) lists no data bypass: every adapter the app builds is wrapped with `viaApi` and no table or function is called on a client directly. The list is a ratchet. It stood at 8 on 2026-11-21 and stands at 1 on 2026-11-23: the auth service (phase 9). The realtime adapters are built on `viaApiRealtime` (phase 6) and the Edge Function services are served through the gateway (phase 8) |
| 6 | **Realtime.** Gateway, Redis fan-out, the ADR-003 topics, reconnect and fallback behavior kept | No Supabase Realtime channel is opened; the realtime tests pass on the new adapter |
| 7 | **Media.** Buckets, CDN, signed uploads, image variants, video pipeline; existing objects copied and verified by checksum | No Supabase Storage call; a k6 media scenario meets its budget |
| 8 | **Background work and webhooks.** The 20 Edge Functions become API modules, queue workers or scheduled jobs; `pg_net` and Vault use removed | No Edge Function is deployed; the health registry covers the queues |
| 9 | **Own identity.** Sign-in, refresh, revocation, account deletion; users moved with their password hashes, so nobody resets a password | The auth contract suite and the two-user E2E journeys pass with KC-issued tokens only |
| 10 | **Database move and cut-over.** Cloud SQL at launch sizing (high availability, point-in-time recovery, read replica), rehearsed twice on dev, then production in a maintenance window; API moves to `me-west1` | Row counts and checksums match per table; the E2E journeys and the k6 suite pass on the new stack; client access to the Supabase projects is switched off |
| 11 | **Hosted adapters and SQL logic become native modules** (continuous). When a context changes or a load test points at it, its hosted adapter is rewritten as a use case with SQL, and its SQL functions as tested TypeScript; new logic for a moved context is not written as a new SQL function | Tracked per context; the compatibility engine is deleted with the last hosted adapter |

Phases 4, 6, 7 and 8 do not depend on each other and can run in parallel with phase 5.

### Status (2026-11-21)

Everything below is on the long-lived branch (PR KC#2576), verified locally on the real schema, and not deployed.

| # | State | What exists | What is left |
|---|---|---|---|
| 1 | Done, image unbuilt | `app/apps/api`: config, errors, request ids, health and readiness, pool and Redis, image definition | Build the image once (needs Docker or CI) |
| 2 | Prepared; blocked on a person | The Terraform of the environment (`infra/gcp`): the service that scales to zero, three service accounts without key files, GitHub's deploy branch trusted through Workload Identity Federation, empty secrets a person fills, the file buckets, the ten jobs paused, a budget alert. Tested against a mocked provider in CI; never applied. The API side of it: a scheduler starts jobs with its own Google identity instead of a stored secret, and one declared instance runs without Redis, so the first environment has no fixed cost | A Google Cloud project with billing (KC#2584); then the first apply, the deploy stage of the workflow, the database login for the API |
| 3 | Done | Token verification against the issuer's key set; every request's database work as the caller | Compare with PostgREST on the Supabase stack in CI |
| 4 | Done in the repo | The baseline harness on plain PostgreSQL; `apps/api/scripts/kc-test-db.sh` | Replace `pg_cron`, `pg_net` and Vault (phases 8 and 10) |
| 5 | Code done, not switched on | Gateway, compatibility engine, 79 ports (375 methods) declared and wrapped in the app, argument checks, dates on the wire, rate limit, visitor cache, CORS; no data call in the app bypasses `viaApi` | Contract suites for the 73 ports that have none; the one method that waits for Storage (`post.republish`); turning `EXPO_PUBLIC_KC_API_URL` on for dev once phase 2 exists |
| 6 | Code done, not switched on ([ADR-011](./ADR-011-realtime-gateway.md)) | The gateway: one WebSocket endpoint (`/v1/realtime`), subscriptions authorized by the policies already on `realtime.messages`, database events through `NOTIFY` with a sweep behind it, client-sent events and presence across instances through Redis, a retention job. The app's five realtime adapters run on it unchanged, through a channel host in `@kc/infrastructure-api`; the API door guard (`app/scripts/check-api-door.mjs`) now looks for every way to reach Supabase (adapters, tables and functions, channels, buckets, hand-built storage addresses, Edge Function calls, the session) and lists what is left: files (phase 7) and sign-in (phase 9). Checked end to end on the KC schema with the real database triggers | A load test on a deployed API; switched on with phase 10, when the `realtime` schema is KC's own (`EXPO_PUBLIC_KC_API_REALTIME`) |
| 7 | Started ([ADR-012](./ADR-012-media-storage.md)) | The design: KC's own object store behind one interface, `storage.objects` kept as the index, and the policies already on it deciding every upload, read and delete. The storage authorizer is built and checked on the real policies. The object store interface with a local-directory implementation, and the member routes (grant an upload, confirm it into the index, signed read address, delete), checked end to end on the KC schema. The app's storage door: one module the nine file helpers go through, on Supabase Storage by default and on KC's storage per build (`EXPO_PUBLIC_KC_API_STORAGE`). `post.republish` is served on a server with a file store, by the unchanged adapter | The Google Cloud Storage implementation is written and checked on the service's emulator (ADR-012); then the buckets and CDN, its check on a real project, and the copy of the existing files, which need the cloud project |
| 8 | Code done: 18 of 20, the other two not carried over | Native modules, each ported with its tests and checked end to end on the KC schema. **Called by the app:** `validate-donation-link` (`apps/api/src/modules/donationLinks`), `public-research-submit` (`modules/publicResearch`), `translate` (`modules/translation`), `extract-external-post` (`modules/postImport`, which imports the pure stages from `@kc/domain` where the Edge Function kept a generated copy), `identity-verification-session` (`modules/identityVerification`). **Webhooks**, as routes outside the gateway (`POST /v1/webhooks/<name>`), where the provider's own credential over the raw body is the only way in and a missing secret fails closed (`platform/webhooks`): `identity-verification-webhook`, `revenuecat-webhook`, `payments-webhook` (`modules/billing`). **Scheduled jobs**, behind one generic route (`POST /v1/jobs/<name>`, bearer `KC_JOBS_TOKEN`, `platform/jobs`): `rotate-research-salt`, `subscriptions-charger`, `embed-worker`, `match-rerank` (`modules/matching`), and the notification push worker `dispatch-notification` (`modules/notifications`; it takes the kind registry from `@kc/domain` and its Hebrew texts from a generated copy of the app's locale, written by the same generator as the Edge Function's), and the outbound WhatsApp sender `whatsapp-sender` (`modules/whatsapp`), and the two jobs that clean up files, on KC's own storage (ADR-012): `reconcile-storage-orphans` (`modules/storageMaintenance`) and `purge-deleted-accounts` (`modules/accountPurge`), and the worker that makes the sanitized copy of each new post photo, `process-post-media` (`modules/postMedia`; its file parser is the Edge Function's, moved as it is). One Gemini client for every model call (`platform/ai`). A service-role database path for server modules; a generic function registry, so a module contributes its function and the gateway knows none by name (ADR-010 section 4). Every function the app itself calls is now served in process | `whatsapp-webhook` is ported: the route (`/v1/webhooks/whatsapp`: the provider's registration check and signed deliveries, failing closed without the app secret) and everything it does with a message through the database (duplicates, the per-phone throttle, storing, consent keywords, link codes, the Pro gate and its upsell) are in `modules/whatsapp/inbound` and checked on the KC schema. The photo a linked Pro member sends to complete a waiting draft is ported too (`inbound/photo.ts`): it is downloaded from the provider, checked, and stored on KC's storage with its index row, after the provider was answered (`platform/background`: work that outlives its request in this process, and is safe to lose). The conversation agent for such a member (`modules/whatsapp/agent`: a tool loop on the model, every tool bound to the one linked member the database resolved) is ported with its tests and runs the same way, after the provider was answered. `backfill-image-thumbs` is a one-off operator tool with no schedule and is not carried over. `strip-exif` rewrote a stored photo in place, which KC's storage does not do (a name is written once); it is replaced by the photo worker removing a member's upload as soon as its sanitized copy is ready (PM decision, 2026-11-25, ADR-012). No port method is `not_served` any more: `post.republish`, the last one, is served wherever the server has a file store (ADR-012). Switching over is configuration, not code: a webhook's provider console points at the API's address, and a job's schedule (today a database job that calls the Edge Function; Cloud Scheduler once phase 2 exists) calls `POST /v1/jobs/<name>` instead. The Edge Function sources and the generated `@kc/domain` mirror stay until the Edge Functions are switched off |
| 9 | Not started | — | Own identity; needs the email provider and sign-in configuration (KC#2584) |
| 10 | Not started | — | After 2 and 5–9 |
| 11 | Not started | — | Continuous, after a port is behind the API |

### Rules while the move is in flight

- A context that has not moved follows ADR-002 as today.
- Once a port is behind the API, a new capability for it ships as a port method with its access decision in the gateway and a contract case, in one PR.
- No new Edge Function after phase 8 starts; no new Realtime channel after phase 6 starts; no new Storage bucket after phase 7 starts.
- Schema changes stay in `supabase/migrations/` with the same numbering rules until phase 10 replaces the runner. The directory name changes last.

### How the work lands in `dev`

Decided by the PM (chat, 2026-11-25), following the architecture review of the branch ([`../backend-migration-plan.md`](../backend-migration-plan.md) section 1.5): the work was developed on one long-lived branch and lands in `dev` as stacked slices, each a pull request of its own that passes the full `CI gate` and can be reverted alone.

| Slice | What | When |
|---|---|---|
| 1 | The decisions: this ADR, ADR-010, ADR-011, ADR-012 and their decision-log entries (documents only) | Now |
| 2 | The server: `app/apps/api`, `app/packages/infrastructure-api`, their CI lane, and what they need from the shared packages that changes nothing for the app | After slice 1 |
| 3 | The application ports for the adapters and direct reads that had none | After the store release build is cut |
| 4 | The app's wiring: `viaApi`, the realtime and storage doors, the door guard | After launch is stable |

Nothing changes at run time with any slice: the app reaches the API only in a build that sets `EXPO_PUBLIC_KC_API_URL`. Work that follows the slices ships as small pull requests into `dev`.

## Rollback

- **Phases 1–9:** every switch is a per-port flag with the Supabase adapter still in place, so rollback is a flag change and a web deploy. Nothing is deleted from Supabase before its replacement has run on `dev` for a full release cycle.
- **Phase 10:** the production database is backed up before the copy; the go / no-go checks run inside the maintenance window, before traffic is reopened, because a rollback after new writes would lose them. The Supabase projects are kept for 30 days with client access switched off, then deleted.
- **Installed builds:** a build that still calls Supabase directly stops working at phase 10. Before that phase, every such build must be below the minimum supported version, so it is asked to update. Whether the app already has that gate is checked in phase 5's first issue; if not, it is built there.

## Cost posture

Development runs on the smallest sizes: the API scales to zero, Redis and Cloud SQL are the smallest tiers and are created only by the phase that first needs them (Redis in phase 3 at the earliest, Cloud SQL in phase 10 rehearsals), and a budget alert exists from phase 2. The first cloud environment runs without Redis at all: an API that is declared a single instance (`KC_API_SINGLE_INSTANCE=1`) keeps its rate counters and realtime members in the process, which is correct for exactly one instance. Without the declaration a missing `REDIS_URL` stops the process at start, and the Terraform of an environment that makes the declaration caps its service at one instance. Managed Redis, the first fixed monthly cost, is added together with a second instance. During phases 1–9 Supabase is still paid for, so the two bills overlap; that overlap is the price of never having a broken app. Launch sizing (replicas, high availability, minimum instances) is set from k6 results in phase 10, not guessed now.

## Alternatives rejected

- **Stay on Supabase and add NestJS beside it** (the original scope of KC#1496). Keeps the schema as the public API and keeps Auth, Storage and Realtime as they are; the PM wants every component owned.
- **Self-host Supabase's open-source stack.** Removes the vendor but keeps the shape: direct database access from clients and logic in SQL.
- **A service and a database per bounded context from day one** (the PM's first idea, withdrawn in the same chat). Distributed transactions, cross-service joins and many times the operations work, for one team and no measured need. Modules with enforced boundaries can be split out later, one at a time, when a load test shows the need.
- **Railway.** No region near Israel and weaker database availability tooling; KC already left it once for web hosting (`D-38`, TD-234).
- **AWS.** Equivalent capability, also has a Tel Aviv region; the PM chose Google Cloud.
- **A second environment built in parallel and switched at the end.** One large cut-over with no partial delivery, chasing a moving codebase.

## Risks

| Risk | Mitigation |
|---|---|
| The move takes months while features keep shipping on the old path | The strangler order: each port ships alone; the rules above stop new Supabase-only surface from being added behind the move |
| Behavior drifts between the two adapters | One contract suite per port on both adapters (`D-204`); two-user E2E journeys on each flag state |
| A migration starts to depend on a Supabase-only feature | Phase 4's guard fails the PR |
| Cross-cloud latency between the API and the database during phases 3–9 | The API runs in the region nearest to the database; pooled connections; one transaction per request |
| A managed service is not offered in `me-west1` | Checked when each service is provisioned; that service runs in the nearest EU region and the choice is recorded in `infra/gcp/` |
| Data loss at cut-over | Two rehearsals on dev, backup, per-table counts and checksums, go / no-go inside the window, the old projects kept for 30 days |
| Cost surprise | Budget alert from phase 2; resources created only when a phase needs them |

## Needs a person

- A Google Cloud project with billing, and permission for CI to deploy to it (before phase 2).
- Apple and Google sign-in configuration for the new identity module (before phase 9).
- The production maintenance window and the go / no-go at phase 10 (owner approval, as for every production deploy, `D-195`).
