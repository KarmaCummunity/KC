# @kc/api

KC's own server: a NestJS application (Fastify) that takes over the app's data access from Supabase one port at a time. Plan and phases: [`docs/architecture/adr/ADR-009-backend-platform.md`](../../../docs/architecture/adr/ADR-009-backend-platform.md).

Today it is a skeleton: it starts, answers `GET /health`, and has the pieces every later route relies on. It is not deployed and the mobile app does not call it yet.

## Run

```bash
pnpm --filter @kc/api build && pnpm --filter @kc/api start   # http://localhost:8080/health
pnpm --filter @kc/api test
```

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `KC_API_ENVIRONMENT` | `development` | `development`, `production` or `test` |
| `KC_API_HOST` | `0.0.0.0` | Interface to bind |
| `PORT` | `8080` | Port to listen on (the name Cloud Run injects) |
| `KC_APP_VERSION` | `0.0.0-dev` | Version reported by `/health` |

An invalid value stops the process at start with an error that names the variable.

## Conventions

- **Layout.** `src/platform/` holds what every route shares (config, errors, request ids, health). A bounded context is a module under `src/modules/<context>/` and is imported in `src/app.module.ts`.
- **Routes.** Business routes are served under `/v1`. `/health` is unversioned.
- **Errors.** Throw `ApiError(code, httpStatus)`; never format an error response in a handler. Every error body is `{ "error": { "code", "requestId" } }`, and an unexpected failure is always `500 internal_error`.
- **Request ids.** Every response carries `x-request-id`; the same id is on the request's log lines.
- **Dependency injection in tests.** Vitest transforms with SWC (see `vitest.config.ts`) so decorator metadata exists, as in the production build.
