# @kc/api

KC's own server: a NestJS application (Fastify) that takes over the app's data access from Supabase one port at a time. Plan and phases: [`docs/architecture/adr/ADR-009-backend-platform.md`](../../../docs/architecture/adr/ADR-009-backend-platform.md).

Today it serves five application ports (`users`, `posts`, `savedPosts`, `chat`, `reports`) through one gateway route, by running the existing Supabase data adapters on the server ([ADR-010](../../../docs/architecture/adr/ADR-010-port-gateway.md)). It is not deployed, and the mobile app does not call it yet.

## Run

```bash
export DATABASE_URL=postgres://user:password@localhost:5432/kc REDIS_URL=redis://localhost:6379
export KC_AUTH_ISSUER=https://<project>.supabase.co/auth/v1
pnpm --filter @kc/api build && pnpm --filter @kc/api start   # http://localhost:8080/health
pnpm --filter @kc/api test                                    # unit and in-process HTTP tests
KC_API_TEST_DISPOSABLE_DATABASE=1 pnpm --filter @kc/api test  # also the platform integration tests; they create roles and a schema, so only on a throwaway database
docker build -f apps/api/Dockerfile -t kc-api .               # from app/
```

### Tests on the real KC schema (no Docker)

The port contract suites and the engine suite run against a throwaway database that holds the whole KC schema. It needs a local PostgreSQL 17 with PostGIS, pgvector and pgTAP:

```bash
DB_URL=postgres://postgres@127.0.0.1:5432/postgres apps/api/scripts/kc-test-db.sh   # prints the line to export
export KC_API_TEST_KC_DATABASE_URL=postgres://postgres@127.0.0.1:5432/kc_api_test
pnpm --filter @kc/api test
```

Without the variable those suites are skipped and the unit tests still run.

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
| `KC_TRANSLATION_PROVIDER` | `googlefree` | Who translates member content: `googlefree` (Google's keyless public endpoint, no cost) or `gemini` |
| `GEMINI_API_KEY` | none | Gemini API key (a secret). Required when `KC_TRANSLATION_PROVIDER` is `gemini` |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Gemini model name |

An invalid value stops the process at start with an error that names the variable and never prints the value. The process starts even when a dependency is unreachable; readiness reports it.

## Health

| Route | Answers | Use |
|---|---|---|
| `GET /health` | `200` while the process serves HTTP | Liveness: restart the instance when it fails |
| `GET /health/ready` | `200` when Postgres and Redis answer, else `503` naming the one that is down | Readiness: send traffic only when it passes |

## Conventions

- **Layout.** `src/platform/` holds what every route shares (config, errors, request ids, logging, database, Redis, health, identity, the port gateway and the PostgREST-compatible engine). `src/modules/hostedAdapters/` lists the ports served by hosted Supabase adapters. A bounded context is a module under `src/modules/<context>/` and is imported in `src/app.module.ts`.
- **Routes.** Business routes are served under `/v1`. `/health` is unversioned.
- **Serving a port.** Declare it with `definePort<Port>()` in `src/modules/hostedAdapters/hostedPorts.ts`: the compiler asks for an access decision for every method (`member`, `public` or `not_served`). Then add its contract suite to `src/__tests__/contracts/gateway.contract.integration.test.ts` and run it on the KC test database. The app calls it with `createRemotePort` from `@kc/infrastructure-api`.
- **Porting an Edge Function.** Write it as a native module under `src/modules/<context>/` with its tests carried over, wrap it in a class that implements `HostedFunction` (the function's name and `handle(request, body)`), and add that class to `src/modules/hostedFunctions/hostedFunctionSet.ts`. Adapters that call `client.functions.invoke('<name>')` then work unchanged, and their methods can move from `not_served` to served. `src/modules/donationLinks` (a member's write), `src/modules/publicResearch` (a visitor's write) and `src/modules/translation` (an outbound provider behind an injected seam) are the models; add an end-to-end case to `src/__tests__/contracts/hostedFunctions.kc.integration.test.ts`.
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
