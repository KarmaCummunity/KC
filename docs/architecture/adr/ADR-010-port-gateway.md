# ADR-010 — The API serves application ports through one gateway, and hosts the Supabase adapters on a SQL engine

- **Status:** Accepted (2026-11-21) · engineering decision `{{ENG:port-gateway-compat-engine}}` · refines phase 5 of [ADR-009](./ADR-009-backend-platform.md)
- **Issue:** epic KC#1496
- **Related:** `D-204` (port contract suites), [ADR-002](./ADR-002-data-layer.md) (RLS and RPCs are the authority), [ADR-003](./ADR-003-realtime.md)

## Context

ADR-009 moves the app behind KC's own API one port at a time. Its first sketch of phase 5 was a hand-written endpoint, DTO and client adapter per port method. Measured on `dev` (2026-11-21), that is the wrong unit of work:

| What exists | Size |
|---|---|
| Application ports / port methods | 54 / about 275 |
| Supabase adapter files / lines behind them | 184 / about 15 000 |
| Calls in those adapters: SQL functions / table queries | 247 / 180 |
| PostgREST vocabulary they use | `eq`, `in`, `or`, `ilike`, `gt` / `lt`, `order`, `limit`, `range`, `single`, counts, upserts, 2 embedded selects |

Two facts make a generic move possible:

1. **The ports are already the contract.** They are plain TypeScript interfaces in `@kc/application`, their values are JSON (ISO strings, no callbacks outside the realtime and auth ports), their errors are typed classes with a `code`, and six of them have shared contract suites.
2. **The adapters speak a small dialect.** Everything they send is a PostgREST request, and the vocabulary above is small enough to answer with SQL directly.

## Decision

### 1. One gateway route instead of an endpoint per method

```
POST /v1/ports/<port>/<method>     { "args": [ … ] }
200                                { "result": … }
422                                { "error": { "code": "port_error", "requestId", "detail": { "port": { type, message, fields } } } }
```

- **Server** (`apps/api/src/platform/ports`): a port is declared with `definePort<Port>()`. The compiler demands an access decision for **every** method of the interface: `member` (signed-in only), `public` (a visitor runs as the `anon` role) or `not_served` (needs Storage, an Edge Function or Realtime; the app keeps its current adapter for it). A method added to a port cannot reach the API, or be forgotten, without that decision. Only methods of the interface can be listed, so an implementation's helpers and prototype names are never callable.
- **Client** (`@kc/infrastructure-api`): `createRemotePort<Port>(transport, name)` is one generic adapter for every port. While a port is partly served, it routes the listed methods to the API and the rest to a fallback adapter.
- **Errors**: a typed domain or application error is serialized (class key, message, own data fields; never `cause` or `stack`) and rebuilt on the app as an instance of the same class, so `instanceof` and `.code` checks behave as with a local adapter. Classes are keyed by export name, which survives minification. Anything else is `500 internal_error`.
- **Identity**: a broken token is refused even on a `public` method; it is never downgraded to "signed out".
- **One definition of the wire format**: `@kc/infrastructure-api/src/wire`, imported by both sides.

The version prefix carries the compatibility promise: within `/v1`, a port method keeps its name, its arguments stay backward compatible (new ones optional and last), and results only gain fields. A breaking change is a new method or a new prefix. Webhooks, health and other non-port routes stay ordinary REST.

### 2. The existing adapters run on the server, unchanged

Rewriting 15 000 lines of adapters as server code would take months and drift from the originals. Instead the API **hosts** them (`apps/api/src/modules/hostedAdapters`):

- `platform/postgrest` is an in-process engine that answers a PostgREST request with one SQL statement: it parses the request (select lists with embedded resources, filters and logic trees, order, paging, counts, inserts and upserts, updates, deletes, function calls with overload resolution from a schema cache), binds every value as a parameter, accepts only plain identifiers, and shapes results and errors the way the adapters read them (`PGRST…` codes, SQLSTATE and message, `Content-Range`, single-object rules). JSON is produced by Postgres itself, as PostgREST does, so value formats are identical.
- `sqlBackedClient` is the PostgREST request builder with its `fetch` replaced by the engine, plus the session lookups adapters make. An adapter receives it typed as its own client.
- **Each request an adapter makes is its own transaction as the caller** (`IdentityDatabase`), exactly what one PostgREST request is today: same role, same claims, same search path, same partial-commit behavior. Grants and row-level security keep deciding what a caller may touch; the engine adds no privilege.
- The engine refuses what it does not implement (`PGRST100`) instead of guessing, and mirrors Supabase's refusal of whole-table updates and deletes.

Only server code builds engine requests. The app can reach a table or function only through a served port method, which is a smaller surface than PostgREST exposes today.

### 3. What this changes in ADR-009

- **Phase 4 (portability guard) already exists.** `scripts/run-baseline-tests.sh` builds the whole migration chain on plain PostgreSQL through `supabase/baseline/local/supabase_shim.sql` and runs the DB suites. It is what makes local verification possible: `apps/api/scripts/kc-test-db.sh` builds a KC database with no Docker.
- **Phase 5 becomes: serve ports through the gateway.** A port is done when its contract suite passes through the gateway and the app's composition root uses the remote port. Ports without a suite get one first.
- **Phase 11 is where adapters are replaced.** A hosted adapter is rewritten as a native module (use case + SQL) when its context changes or a load test points at it. The engine shrinks as they go and is deleted with the last one.
- The API may import `@kc/infrastructure-supabase` and `@supabase/postgrest-js`; it may not import the Supabase network client or the UI kit (`check-architecture.mjs`).

## How a port moves

1. Declare it in `hostedPorts.ts` with an access decision per method.
2. Run its contract suite through the gateway on the KC test database (`src/__tests__/contracts/gateway.contract.integration.test.ts`); write the suite first if the port has none.
3. In the app's composition root, wrap the port with `createRemotePort`, behind the backend flag.

Proven so far (2026-11-21): `users`, `posts`, `savedPosts`, `chat`, `reports` — 57 contract cases pass end to end (remote port → HTTP → gateway → adapter → engine → the real schema, as the calling member), and the same cases pass on the engine alone.

## Consequences and limits

- **Arguments are not yet validated against the port's types.** Postgres validates what reaches SQL (types, RLS, constraints), so this is a robustness gap, not a privilege one: a malformed argument can end as a `500` instead of a `400`. Follow-up: generate validators from the port interfaces and check them in the gateway.
- **One port call can be several transactions**, as today. Atomicity improves only when an adapter is rewritten natively.
- **Three round trips of overhead per adapter request** (`begin`, set identity, `commit`). Acceptable while the API sits next to the database; a pipelined identity statement is the first optimization if a load test asks for it.
- **Values are JSON.** A port with a `Date`, a binary value or a callback needs a codec extension or its own route. Today that is the realtime and auth ports (phases 6 and 9) and one `Date` in the legal-documents port.
- **The engine implements the dialect the adapters use, not all of PostgREST** (no casts, JSON paths, aggregates, full-text operators, estimated counts, GET function calls). An adapter that starts using one fails loudly with `PGRST100`.

## Alternatives rejected

- **An endpoint, DTO and client adapter per method.** About 275 of each, written and kept in sync by hand.
- **Rewrite the adapters as native server code first.** Months of work with no partial delivery, and behavior drift on every line.
- **Run the real PostgREST behind the API as a sidecar.** Same semantics for free, but one more service to deploy and secure, a second connection pool, and it keeps the option of exposing the schema; the dialect in use is small enough to own.
- **tRPC or GraphQL.** Both add a schema layer that would duplicate the port interfaces, which are already the typed contract with contract suites behind them.
