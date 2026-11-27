# @kc/api

KC's own server: a NestJS application (Fastify) that takes over the app's data access from Supabase one port at a time. Plan and phases: [`docs/architecture/adr/ADR-009-backend-platform.md`](../../../docs/architecture/adr/ADR-009-backend-platform.md).

Today it serves five application ports (`users`, `posts`, `savedPosts`, `chat`, `reports`) through one gateway route, by running the existing Supabase data adapters on the server ([ADR-010](../../../docs/architecture/adr/ADR-010-port-gateway.md)). It is not deployed, and the mobile app does not call it yet.

## Run

```bash
export DATABASE_URL=postgres://user:password@localhost:5432/kc REDIS_URL=redis://localhost:6379
export KC_AUTH_ISSUER=https://<project>.supabase.co/auth/v1
pnpm --filter @kc/api build && pnpm --filter @kc/api start   # http://localhost:8080/health
pnpm --filter @kc/api test                                    # unit and in-process HTTP tests
KC_API_TEST_DISPOSABLE_DATABASE=1 pnpm --filter @kc/api test  # also the platform integration tests (with DATABASE_URL and REDIS_URL set); they create roles and a schema, so only on a throwaway database
docker build -f apps/api/Dockerfile -t kc-api .               # from app/
```

### Tests on the real KC schema (no Docker)

The port contract suites and the engine suite run against a throwaway database that holds the whole KC schema. It needs a local PostgreSQL 17 with PostGIS, pgvector and pgTAP:

```bash
DB_URL=postgres://postgres@127.0.0.1:5432/postgres apps/api/scripts/kc-test-db.sh   # prints the line to export
export KC_API_TEST_KC_DATABASE_URL=postgres://postgres@127.0.0.1:5432/kc_api_test
pnpm --filter @kc/api test
```

Without the variable those suites are not collected and the unit tests still run (`vitest.config.ts` lists which suites need what). Coverage has two floors there: the full one when both kinds of database are present, and a lower one for a run without them.

In CI the frontend lane runs the package without a database (the lower floor). The backend lane (`.github/workflows/ci-backend.yml`) runs every suite on the local Supabase stack's Postgres with Redis 7.2 (the full floor), and builds this package's container image and starts it. That lane is planned for a pull request that touches `app/apps/api` or `app/packages/infrastructure-api`, and always runs in the merge queue.

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `KC_API_ENVIRONMENT` | `development` | `development`, `production` or `test` |
| `KC_API_HOST` | `0.0.0.0` | Interface to bind |
| `PORT` | `8080` | Port to listen on (the name Cloud Run injects) |
| `KC_APP_VERSION` | `0.0.0-dev` | Version reported by `/health` |
| `DATABASE_URL` | required | Postgres connection string (`postgres://` or `postgresql://`) |
| `REDIS_URL` | required | Redis connection string (`redis://` or `rediss://`) |
| `KC_AUTH_ISSUER` | required | Issuer of accepted access tokens, exactly as in the token's `iss`; keys are read from `<issuer>/.well-known/jwks.json` |
| `KC_API_ALLOWED_ORIGINS` | none | Comma-separated web origins that may call the API from a browser (CORS), e.g. `https://app.example.org`. The native apps need no entry. The public research survey accepts answers only from a page on one of these origins |
| `KC_API_TRUSTED_PROXY_HOPS` | `0` | Reverse proxies in front of the API whose `X-Forwarded-For` entry is trusted for the client address |
| `KC_API_RATE_LIMIT_PER_MINUTE` | `600` | Port calls one caller may make per minute (a member by user id, a visitor by address), counted in Redis. `0` switches the limit off |
| `KC_JOBS_TOKEN` | none | Bearer token a scheduler sends to start a job (`POST /v1/jobs/<name>`); a secret of at least 32 characters. Without it no job can be started |
| `EXPO_ACCESS_TOKEN` | none | Access token of the Expo push service, when the Expo project requires one (a secret) |
| `KC_APP_BASE_URL` | the product's address | The app's public web address, which a message to a member links to (for example the edit link of a draft) |
| `KC_PORT_ROLLOUT` | everyone | Who each served port is served to: a JSON object of port name to `{ "percent": 0-100, "minAppVersion": "1.2.3" }`, with `*` for every port without a rule of its own (ADR-010). A rule for a port that does not exist stops the process at start |
| `KC_STORAGE_LOCAL_DIR` | none | Directory of the local file store, for development and tests only (ADR-012). Without a store the storage routes answer `503 not_configured` |
| `KC_API_PUBLIC_URL` | none | The API's own address as clients reach it; required with `KC_STORAGE_LOCAL_DIR`, whose upload and read addresses point back at the API |
| `WHATSAPP_CLOUD_API_TOKEN` | none | Graph API token of the WhatsApp channel (a secret). Without it no WhatsApp message is sent |
| `WHATSAPP_PHONE_NUMBER_ID` | channel settings | Overrides the phone number id stored with the channel's settings |
| `WHATSAPP_VERIFY_TOKEN` | none | The token the WhatsApp provider echoes when the inbound webhook is registered (a secret). Without it registration is refused |
| `WHATSAPP_APP_SECRET` | none | The app secret inbound WhatsApp deliveries are signed with (a secret). Without it every delivery is refused |
| `WHATSAPP_GRAPH_API_VERSION` | channel settings, else `v21.0` | Overrides the Graph API version |
| `KC_TRANSLATION_PROVIDER` | `googlefree` | Who translates member content: `googlefree` (Google's keyless public endpoint, no cost) or `gemini` |
| `GEMINI_API_KEY` | none | Gemini API key (a secret), used by the post import and, when selected, by translation. Required when `KC_TRANSLATION_PROVIDER` is `gemini` |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Gemini model name |
| `KC_IMPORT_MODEL` | `GEMINI_MODEL` | Gemini model that reads a shared message in the external post import. Without `GEMINI_API_KEY` every import falls back to the manual route |
| `KC_IMPORT_DAILY_BUDGET` | `2000` | Model calls the post import may make per UTC day, for all members together |
| `IDV_PROVIDER` | `didit` | Identity verification provider. Only `didit` has an adapter |
| `IDV_PROVIDER_API_KEY` | none | The provider's API key (a secret). Without it and the workflow id no verification session can be opened |
| `IDV_DIDIT_WORKFLOW_ID` | none | The verification workflow configured in the provider's console |
| `IDV_WEBHOOK_SECRET` | none | Shared secret of the provider's event signature (a secret). Without it every provider event is refused |
| `IDV_IDENTITY_HASH_KEY` | none | Key of the hash that recognizes one document across accounts (a secret). Without it no approval is applied. Must be the same value the Edge Function used: changing it orphans the stored hashes |
| `IDV_CALLBACK_URL` | none | Where the provider's hosted flow sends the member when done |
| `REVENUECAT_WEBHOOK_AUTH` | none | The shared secret RevenueCat sends in its Authorization header (a secret). Without it every store event is refused |
| `REVENUECAT_PRO_ENTITLEMENT_ID` | `pro` | RevenueCat entitlement of a member's Pro tier |
| `REVENUECAT_ORG_ENTITLEMENT_ID` | `org` | RevenueCat entitlement of an organization's paid plan |
| `PAYMENTS_WEBHOOK_SECRET_<SLUG>` | none | Signing secret of one payment provider, by its slug in upper case, e.g. `PAYMENTS_WEBHOOK_SECRET_SANDBOX` (secrets). A provider without one is refused |

An invalid value stops the process at start with an error that names the variable and never prints the value. The process starts even when a dependency is unreachable; readiness reports it.

## Realtime

`GET /v1/realtime` upgrades to a WebSocket (ADR-011). The first frame is `{ "op": "auth", "token": "<access token>" }`; then the client subscribes to topics (`{ "op": "subscribe", "ref", "topic", "extension" }`) and is sent their events. The frames are defined once, in `@kc/infrastructure-api` (`src/wire/realtimeWire.ts`). Who may join a topic is decided by the row-level-security policies on `realtime.messages`, so a new topic needs a policy and an SQL test, and no change here. The database sends an event with `kc_private.broadcast`; the API hears it through `NOTIFY kc_realtime`.

## File storage

[ADR-012](../../../docs/architecture/adr/ADR-012-media-storage.md). A member's file moves in three steps: `POST /v1/storage/uploads` grants an upload of `<bucket>/<name>` and returns the address to send the bytes to; the app sends them there; `POST /v1/storage/uploads/complete` writes the file into the index (`storage.objects`). `POST /v1/storage/signed-urls` gives a short-lived address of a private file, and `POST /v1/storage/objects/delete` removes the member's files. Who may do what is decided by the policies on `storage.objects` (`src/platform/storage/storageAuthorizer.ts`), never by the API's own code. The bytes live behind the `ObjectStore` interface: a local directory here, Google Cloud Storage when deployed. Server modules that work on files inject `OBJECT_STORE`.

## Health

| Route | Answers | Use |
|---|---|---|
| `GET /health` | `200` while the process serves HTTP | Liveness: restart the instance when it fails |
| `GET /health/ready` | `200` when Postgres and Redis answer, else `503` naming the one that is down | Readiness: send traffic only when it passes |

## Conventions

- **Layout.** `src/platform/` holds what every route shares (config, errors, request ids, logging, database, Redis, health, identity, the port gateway and the PostgREST-compatible engine). `src/modules/hostedAdapters/` lists the ports served by hosted Supabase adapters. A bounded context is a module under `src/modules/<context>/` and is imported in `src/app.module.ts`.
- **Routes.** Business routes are served under `/v1`. `/health` is unversioned.
- **Serving a port.** Declare it with `definePort<Port>()` in `src/modules/hostedAdapters/hostedPorts.ts`: the compiler asks for an access decision for every method (`member`, `public` or `not_served`). Then add its contract suite to `src/__tests__/contracts/gateway.contract.integration.test.ts` and run it on the KC test database. The app calls it with `createRemotePort` from `@kc/infrastructure-api`.
- **Porting an Edge Function.** Write it as a native module under `src/modules/<context>/` with its tests carried over, wrap it in a class that implements `HostedFunction` (the function's name and `handle(request, body)`), and add that class to `src/modules/hostedFunctions/hostedFunctionSet.ts`. Adapters that call `client.functions.invoke('<name>')` then work unchanged, and their methods can move from `not_served` to served. `src/modules/donationLinks` (a member's write), `src/modules/publicResearch` (a visitor's write) `src/modules/translation` (an outbound provider behind an injected seam) and `src/modules/postImport` (a pipeline over `@kc/domain` stages, with limits counted in the database) are the models; add an end-to-end case to `src/__tests__/contracts/hostedFunctions.kc.integration.test.ts`.
- **Porting a scheduled job.** A job is a class that implements `ScheduledJob` (`src/platform/jobs/scheduledJob.ts`): the name a scheduler calls and `run(input)`, which does one bounded batch and returns counters. Keep the rules in a pure function with its dependencies injected, as the Edge Function's handler was, and add the class to `src/modules/scheduledJobs/scheduledJobSet.ts`. The route (`POST /v1/jobs/<name>`, bearer `KC_JOBS_TOKEN`) is generic. A job keeps the name of the Edge Function it replaces, so its schedule only changes address. `src/modules/matching` is the model; add an end-to-end case to `src/__tests__/contracts/scheduledJobs.kc.integration.test.ts`.
- **Porting a webhook.** A provider cannot send a member token, so a webhook is its own route under `/v1/webhooks/<name>`, not a port: a controller in the feature's module that hands the raw body (`request.rawBody`) and the headers to a pure function, which verifies the provider's signature before anything else and fails closed without a secret. The answers are the provider's protocol and are sent as they are. `src/modules/identityVerification` (a signature with a timestamp) and `src/modules/billing` (a shared secret; a signature chosen by the provider the body names) are the models. The provider's console must point at the new address when the Edge Function is switched off.
- **Changing a port interface.** Run `pnpm --filter @kc/api generate:port-args` and commit `portArgShapes.generated.json`: the gateway checks every call's arguments against it, and a test fails while it is stale.
- **The engine is not PostgREST.** It implements the dialect the adapters use and refuses the rest with `PGRST100`. If an adapter needs more, extend `src/platform/postgrest` with a unit test and a case on the KC schema; never loosen identifier or value handling.
- **Errors.** Throw `ApiError(code, httpStatus)`; never format an error response in a handler. Every error body is `{ "error": { "code", "requestId" } }`, and an unexpected failure is always `500 internal_error`.
- **Who is calling.** Put `@UseGuards(AuthenticatedGuard)` on a signed-in route and take the caller with `@Caller()`. Every rejected token is the same `401 unauthorized`.
- **Database work for a request.** Use `IdentityDatabase.runAs(caller, work)` (or `runAnonymous`): one transaction with the caller's role and claims, so `auth.uid()`, RLS and the existing SQL functions behave as they do through PostgREST. The database user in `DATABASE_URL` must be allowed to switch to the `authenticated` and `anon` roles.
- **Connections.** Inject `DATABASE_POOL` (`pg` pool) and `REDIS_CLIENT` (`ioredis`); never open a connection of your own. Both are closed on shutdown.
- **Logging outside a request.** Inject `APP_LOGGER`; inside a handler use `request.log`, which carries the request id.
- **Limits.** The gateway counts every port call that reaches a method against the caller's allowance and answers `429` with `retry-after` beyond it. When Redis is down the limiter lets calls through and logs a warning.
- **Request ids.** Every response carries `x-request-id`; the same id is on the request's log lines.
- **Dependency injection in tests.** Vitest transforms with SWC (see `vitest.config.ts`) so decorator metadata exists, as in the production build.
