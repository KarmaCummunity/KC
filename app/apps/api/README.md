# @kc/api

KC's own server: a NestJS application (Fastify) that takes over the app's data access from Supabase one port at a time. Plan and phases: [`docs/architecture/adr/ADR-009-backend-platform.md`](../../../docs/architecture/adr/ADR-009-backend-platform.md).

Today it is a foundation: it starts, connects to Postgres and Redis, reports liveness and readiness, verifies access tokens and runs database work as the caller. It has one business route, `GET /v1/session`. It is not deployed and the mobile app does not call it yet.

## Run

```bash
export DATABASE_URL=postgres://user:password@localhost:5432/kc REDIS_URL=redis://localhost:6379
export KC_AUTH_ISSUER=https://<project>.supabase.co/auth/v1
pnpm --filter @kc/api build && pnpm --filter @kc/api start   # http://localhost:8080/health
pnpm --filter @kc/api test                                    # unit and in-process HTTP tests
KC_API_TEST_DISPOSABLE_DATABASE=1 pnpm --filter @kc/api test  # also the integration tests; they create roles and a schema, so only on a throwaway database
docker build -f apps/api/Dockerfile -t kc-api .               # from app/
```

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

An invalid value stops the process at start with an error that names the variable and never prints the value. The process starts even when a dependency is unreachable; readiness reports it.

## Health

| Route | Answers | Use |
|---|---|---|
| `GET /health` | `200` while the process serves HTTP | Liveness: restart the instance when it fails |
| `GET /health/ready` | `200` when Postgres and Redis answer, else `503` naming the one that is down | Readiness: send traffic only when it passes |

## Conventions

- **Layout.** `src/platform/` holds what every route shares (config, errors, request ids, logging, database, Redis, health). A bounded context is a module under `src/modules/<context>/` and is imported in `src/app.module.ts`.
- **Routes.** Business routes are served under `/v1`. `/health` is unversioned.
- **Errors.** Throw `ApiError(code, httpStatus)`; never format an error response in a handler. Every error body is `{ "error": { "code", "requestId" } }`, and an unexpected failure is always `500 internal_error`.
- **Who is calling.** Put `@UseGuards(AuthenticatedGuard)` on a signed-in route and take the caller with `@Caller()`. Every rejected token is the same `401 unauthorized`.
- **Database work for a request.** Use `IdentityDatabase.runAs(caller, work)` (or `runAnonymous`): one transaction with the caller's role and claims, so `auth.uid()`, RLS and the existing SQL functions behave as they do through PostgREST. The database user in `DATABASE_URL` must be allowed to switch to the `authenticated` and `anon` roles.
- **Connections.** Inject `DATABASE_POOL` (`pg` pool) and `REDIS_CLIENT` (`ioredis`); never open a connection of your own. Both are closed on shutdown.
- **Logging outside a request.** Inject `APP_LOGGER`; inside a handler use `request.log`, which carries the request id.
- **Request ids.** Every response carries `x-request-id`; the same id is on the request's log lines.
- **Dependency injection in tests.** Vitest transforms with SWC (see `vitest.config.ts`) so decorator metadata exists, as in the production build.
