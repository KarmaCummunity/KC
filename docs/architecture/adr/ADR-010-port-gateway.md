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

- **Server** (`apps/api/src/platform/ports`): a port is declared with `definePort<Port>()`. The compiler demands an access decision for **every** method of the interface: `member` (signed-in only), `public` (a visitor runs as the `anon` role), `member_with_files` (a member, on a server that has a file store: ADR-012) or `not_served` (needs Storage, an Edge Function or Realtime; the app keeps its current adapter for it). A method added to a port cannot reach the API, or be forgotten, without that decision. Only methods of the interface can be listed, so an implementation's helpers and prototype names are never callable.
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

### 4. Edge Functions an adapter calls

Some adapter methods call an Edge Function instead of the database (`client.functions.invoke(name, { body })`). Once a function is ported to the API as a native module (ADR-009 phase 8), the SQL-backed client answers that call in process, in the shape the Supabase functions client uses (`data` for a 2xx answer, otherwise an error that carries the response). The adapter needs no change and its methods become served. A function that is not ported yet is refused by name, and its methods stay `not_served`.

The gateway knows no function by itself. A function is a class that implements `HostedFunction` (`platform/ports/hostedFunction.ts`): the name the adapters call and one `handle(request, body)` method. Each module contributes its own, `modules/hostedFunctions/hostedFunctionSet.ts` is the one list, and the registry (`HostedFunctions`) fails at start-up on a duplicate name. What a function may know about the request (the caller, the `Origin` header, the client address behind the trusted proxies, the user agent) is handed to it by the gateway, so no function reads a header itself.

A function that visitors call, as `public-research-submit` is, has no database grant to lean on: its method is `public` because the module is its own guard. That function only accepts a browser page on one of the origins in `KC_API_ALLOWED_ORIGINS` (the same list as CORS; the Edge Function's built-in localhost and preview-deploy patterns are not carried over), and the database function it calls keeps the honeypot, the per-visitor limits and the circuit breaker.

A ported function may need to write as the service role, as it did with the service key. `IdentityDatabase.runAsService` and `PortClients.serviceClient()` are that path: for server modules only, after the module has checked the caller itself, and never handed to a hosted adapter.

## How a port moves

1. Declare it in `hostedPorts.ts` with an access decision per method.
2. Run its contract suite through the gateway on the KC test database (`src/__tests__/contracts/gateway.contract.integration.test.ts`); write the suite first if the port has none.
3. In the app's composition root, wrap the port with `createRemotePort`, behind the backend flag.

State on 2026-11-23: 79 ports (375 methods) are declared and wrapped in the app. Six of them have shared contract suites (`user`, `post`, `savedPosts`, `chat`, `report`: 57 cases), which pass end to end (remote port → HTTP → gateway → adapter → engine → the real schema, as the calling member) and on the engine alone. The other ports have no contract of their own yet; they are covered by the schema audit (every function and table they name exists in a shape the engine serves), by the access checks, and by the all-ports run: every served method is called once on the real schema with well-typed sample arguments generated from its shapes, and the run fails on any request the engine cannot serve, any SQL it builds wrongly, any missing table, column or function, and any crash in an adapter. On 2026-11-21 it made 360 calls: no engine fault, no crash, and 175 refusals by the database that all depend on the data (a rule, no permission, a constraint, a meaningless sample value). In production the same engine faults are logged as errors with the request's path and never its values.

## Who a served port is served to

A port the API serves is, by default, served to every app build that is pointed at the API. Two settings narrow that, both on the server, so a move can be staged and undone without a new build:

- **A share of the members.** The manifest may carry `rollout: { <port>: { percent } }`. The app serves a member from the API when their place (a stable hash of their id and the port's name, 0 to 99) is below the share. Whoever is in at 10 is in at 50; a signed-out visitor is served only at 100. `percent: 0` takes a port off the API for everyone within the manifest's lifetime (five minutes).
- **A lowest app version.** `minAppVersion` keeps a port on the adapters in place for builds older than the one that is known to work with it.

The rules are configuration (`KC_PORT_ROLLOUT`, a JSON object by port name; `*` is the rule of every port without its own). A rule that names a port the API does not have, or carries a field it does not know, stops the server at start: a typo must not turn a staged move into "everyone". The rules choose a route; they are not access, which stays with the token and the database.

**The app never waits on the API to start.** The manifest is fetched with a bound (two seconds). A manifest that does not arrive in time, or an API that is down, means nothing is served: every port uses the adapter in place, and the next attempt comes thirty seconds later, in the background.

## Consequences and limits

- **Arguments are checked against the port's types.** `scripts/generate-port-args.mjs` reads every catalog port with the TypeScript checker and writes each method's parameter shapes to `portArgShapes.generated.json`; the gateway refuses a call that does not match with `400 invalid_arguments` before any adapter code runs. The shapes are never stricter than the types: what cannot be described is accepted, and an object may carry fields the server does not know. A test fails when a port interface changes without the file (`pnpm --filter @kc/api generate:port-args`). Postgres still validates what reaches SQL.
- **One port call can be several transactions**, as today. Atomicity improves only when an adapter is rewritten natively.
- **Two round trips of overhead per adapter request**: one opens the transaction and sets the caller, one commits. They cost little while the API sits next to the database and grow with the distance between them, which is why the API runs in the database's region.
- **Values are JSON, plus dates.** JSON has no date type, so a `Date` travels as a marker (`{ "$date": … }`) and is rebuilt on the other side. The generator lists the methods whose arguments or result hold a `Date` (`typedMethods`, 35 today: admin, finance, WhatsApp admin, legal documents and others), and only those pay for the marking. A binary value or a callback still needs its own route: that is the realtime and auth ports (phases 6 and 9).
- **The engine implements the dialect the adapters use, not all of PostgREST** (no casts, JSON paths, aggregates, full-text operators, estimated counts, GET function calls). An adapter that starts using one fails loudly with `PGRST100`.
- **The engine is held to a real PostgREST, request by request.** A suite calls every served method of every hosted port twice with the same arguments, as two fresh members in the same state: once on the engine and once on a real PostgREST over the same database (the local Supabase stack, in the backend CI lane). Every request the adapter made must have been answered alike: status, `Content-Range`, body, error code and text; methods a visitor may call are compared once more without a caller. Its first run found 44 methods answered differently, none of them in the rows returned: the status of some database errors, the row range reported for a change, `201` for a created row asked for as one object, a refused visitor's `401`, and the wording of an unknown function. All were corrected in the engine. Two differences remain by decision: PostgREST's hint that suggests a similarly named function is not produced, and one method that ranks every member in the database is compared by the shape of its answer, since two members never see the same list. The arguments are samples, so the comparison covers what each method asks of the database, not every answer a database full of data can give.

## Scaling levers already in place

- **Stateless API.** No session or cache lives in an instance, so instances are added and removed freely.
- **Bounded pool, short transactions.** Each instance holds at most ten database connections, and every transaction is one request of an adapter, which also makes the API safe behind a transaction-mode connection pooler.
- **Visitor cache.** A `public` method can declare how long its answer may be reused for signed-out visitors (`visitorCacheSeconds`). All visitors share one database role, so one answer serves them all; a member's call is never cached. A cache on a method that is not `public` stops the API at start-up.
- **Rate limit.** Every call that reaches a method is counted per caller in Redis, across instances; beyond the allowance the gateway answers `429` without running the method. Redis being down turns the limit and the cache off, never the API.

Measured on one machine (API process, PostgreSQL and the load generator sharing it; 50 connections; 2026-11-21), so the numbers show ratios, not capacity: a visitor's port call ran at about 1 150 requests a second with a 40 ms median when every call reached the database, and at about 10 500 a second with a 4 ms median from the visitor cache. With the limiter at its default, a client that sent 57 000 calls in five seconds got exactly 600 answers and `429` for the rest. Real capacity is measured with the repo's k6 suite once the API runs in the cloud (ADR-009, phase 10).

## Alternatives rejected

- **An endpoint, DTO and client adapter per method.** About 275 of each, written and kept in sync by hand.
- **Rewrite the adapters as native server code first.** Months of work with no partial delivery, and behavior drift on every line.
- **Run the real PostgREST behind the API as a sidecar.** Same semantics for free, but one more service to deploy and secure, a second connection pool, and it keeps the option of exposing the schema; the dialect in use is small enough to own.
- **tRPC or GraphQL.** Both add a schema layer that would duplicate the port interfaces, which are already the typed contract with contract suites behind them.
