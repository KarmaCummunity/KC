# FSM kernel — design

> **Status:** Accepted 2026-11-09; implemented (migration `0680_fsm_catalog.sql`). The executed build plan is archived at `docs/SSOT/archive/superpowers/plans/2026-11-09-fsm-kernel.md`; §8 records where the shipped layout differs from it. Inventory of every lifecycle and the migration order: [`docs/architecture/state-machines.md`](../../architecture/state-machines.md).
> **Mapped to spec:** FR-ADMIN-018 (pilot preserves the admin-task graph). Later content moves follow S1 in `docs/spec/07_cross_cutting_systems.md` §7.1 and are out of this spec.
> **Decision:** One pure graph in `@kc/domain`, one row catalog in Postgres, one assert function, one contract test that fails when the two catalogs differ. Migrations of the other machines are later issues.

## 1. Problem

KC has dozens of lifecycles. Each one is a closed set of statuses and a set of legal moves. Today the moves are written separately in TypeScript, in SQL `check` lists, and in per-RPC `if` branches. Those copies already disagree.

Two copies of the same move list are not a theoretical risk. `giving_handoffs` is one table. The item handoff graph rejects `reserved → handed_over`. The ride-booking helper allows it. The product book says an unapproved ride booking is cancelled when the ride completes (`docs/spec/05_giving_worlds.md` §5.3). `users.account_status` includes `pending_deletion` in the database and omits it from the domain union. Post status changes that mint karma had to be locked behind a trigger because a direct table update skipped the application.

A shared kernel is the infrastructure. Moving each lifecycle onto it is later work, one machine at a time.

## 2. What this spec ships

In:

- A pure domain module that defines a machine and answers "is this move legal?"
- Postgres tables `fsm_state` and `fsm_edge`, written only by migrations.
- `fsm_assert_transition(machine, from, to, role)`, security definer, the only runtime reader of those tables.
- A contract test that replays `fsm_state` / `fsm_edge` data statements from `supabase/migrations` and fails if the result differs from the domain catalog.
- One pilot: the admin-task graph, with the same edges, the same RPC error codes, and no screen change.
- A `before update` trigger on `admin_tasks` so a later grant of table `update` cannot skip the graph. Today `authenticated` already has no update grant (`0144`).

Out, each one a later issue after this kernel exists:

1. Ride template graph (application only today).
2. Item handoff and ride booking, as two registered machines on the shared assert, aligned to the product book. Unapproved ride bookings cancel. They do not complete.
3. Account status, including `pending_deletion`, plus onboarding, plus the sign-in gate that reads both.
4. Post status (S1) and listing status, including the moderation states a client must not enter.
5. Ride listing lifecycle, then the legacy `ride_participants` graph (keep or retire in that issue).
6. Follow requests, chat messages, reports.
7. Volunteer opportunities and shift signups.
8. Payments, standing orders, refunds, payouts, finance ledger, timesheets, CRM, and the five `pending → approved | rejected` queues.
9. WhatsApp session, consent, template review, and outbound delivery.
10. Client step lists (closure sheet, draft hydration) on the same pure helper, with no SQL catalog, because the server does not own them.

Still out of the kernel itself, including in those later issues until a spec says otherwise:

- Side effects. Karma, notifications, chat lines, and audit rows stay in the use case or the trigger that runs after a legal move.
- Predicates that read other rows: free seats, a time window, an active reservation. The caller checks those, then asks the kernel about the edge.
- Derived states with no status column: translation (`hit | translating | source`), Pro (`active` and `expires_at`), notification outbox (`dispatched_at`).
- Composite status, such as a match candidate whose real state is `status` plus two response columns. That needs its own spec. It is not an edge list.

No screen copy changes. No new dependency. Domain stays free of `node_modules` imports.

## 3. Domain API

Files, each under the 300-line cap:

| File | Responsibility |
| --- | --- |
| `app/packages/domain/src/fsm/TransitionError.ts` | `TransitionError extends DomainError` |
| `app/packages/domain/src/fsm/machine.ts` | Types, `defineMachine`, `canTransition`, `assertTransition`, `isTerminal` |
| `app/packages/domain/src/fsm/catalog.ts` | `FSM_MACHINES`, the only registry |
| `app/packages/domain/src/fsm/machines/adminTask.ts` | The pilot declaration |
| `app/packages/domain/src/fsm/index.ts` | Re-exports |
| `app/packages/domain/src/index.ts` | Re-exports the fsm barrel |

`AdminTask.ts` keeps `ADMIN_TASK_STATUSES`, `isStatusTransitionAllowed`, and the existing tests. `isStatusTransitionAllowed` becomes a call to `canTransition` on the pilot machine. Callers outside the domain do not change.

### 3.1 Shape

```ts
type FsmEdge<S extends string, R extends string> = {
  readonly from: S;
  readonly to: S;
  readonly roles?: readonly R[];
};

type FsmMachine<S extends string, R extends string> = {
  readonly id: string;
  readonly states: readonly S[];
  readonly edges: readonly FsmEdge<S, R>[];
};
```

`id` matches `^[a-z][a-z0-9_]*$`. The pilot id is `admin_task`.

`defineMachine` runs at module load and throws `ValidationError` when:

- `states` is empty, or a status is repeated.
- An edge names a status outside `states`.
- Two edges share the same `(from, to)`. Roles for that pair live on one edge.
- `roles` is present and empty. Omitted `roles` means every caller. An empty list would mean nobody, which is a deleted edge, not a role list.
- A role is repeated on one edge.

### 3.2 Answers

`canTransition(machine, from, to, role?)` returns either `{ ok: true, changed: boolean }` or `{ ok: false, code }`.

`assertTransition` returns the same `{ ok: true, changed }` value, or throws `TransitionError` with that `code`. The error message is the code. `details` carries `machine`, `from`, `to`, and `role` when the caller passed one. Domain copy stays machine-readable; screens translate codes themselves.

`TransitionError.code` is one of:

| Code | When |
| --- | --- |
| `unknown_state` | `from` or `to` is not in `states`. Checked first, including when `from === to`. |
| `illegal_transition` | Both statuses exist, they differ, and no edge connects them. |
| `forbidden_role` | An edge exists and lists roles, and the caller role is missing or not in that list. |

Same status, both known: `{ ok: true, changed: false }`. No edge required. This matches admin tasks and ride templates, which treat a repeated write as a no-op.

Role rule, fail closed:

- Edge omits `roles`: any `role` argument, including `undefined`, is allowed.
- Edge lists roles: `role` must be one of them. `undefined` is `forbidden_role`.

`isTerminal(machine, state)` is true when `state` is known and no edge leaves it. An unknown status returns false. `archived` on the pilot is terminal. A known status that never appears on an edge is terminal too; the pilot has no such status.

The kernel does not accept a predicate callback. A use case that needs one runs it before `assertTransition`.

## 4. Postgres catalog

One new file under `supabase/migrations/`. Its number is the next free number in a range claimed at implementation time (`docs/agents/MIGRATION_RANGES.md`). This spec does not reserve a number. Do not edit `0145` or any earlier migration.

```sql
create table public.fsm_state (
  machine_id text not null,
  status     text not null,
  primary key (machine_id, status)
);

create table public.fsm_edge (
  machine_id  text not null,
  from_status text not null,
  to_status   text not null,
  role        text not null default '',
  primary key (machine_id, from_status, to_status, role),
  foreign key (machine_id, from_status) references public.fsm_state (machine_id, status),
  foreign key (machine_id, to_status)   references public.fsm_state (machine_id, status)
);
```

`role = ''` means the edge is not role-restricted. A pair that has a `''` row has no other rows. A role-restricted pair has one row per role and no `''` row. The contract test rejects any other combination.

RLS is enabled. Each table has an explicit deny-all policy (`for all to anon, authenticated using (false) with check (false)`) because the RLS lint requires every RLS table to carry a policy. `anon` and `authenticated` also receive no privileges, so clients still have no access. Clients never read or write the catalog. Only migrations change rows.

`public.fsm_assert_transition(p_machine text, p_from text, p_to text, p_role text default null)`:

1. `unknown_state` when either status is absent for that machine. `errcode` `P0001`, message `unknown_state`.
2. Return with no error when `p_from = p_to`.
3. Return when a row exists for `(machine, from, to, '')`.
4. Return when `p_role` is not null and a row exists for `(machine, from, to, p_role)`.
5. `forbidden_role` when the pair has rows and none matched. Message `forbidden_role`, `errcode` `P0001`.
6. `illegal_transition` when the pair has no rows. Message `illegal_transition`, `errcode` `P0001`.

The function is `security definer`, `search_path = public`, and `execute` is revoked from `public`, `anon`, and `authenticated`. Definer RPCs call it as the owner. A later table trigger calls it the same way, so a client update grant still cannot read the catalog directly.

### 4.1 How a later machine registers

1. Add a machine module and a `FSM_MACHINES` entry.
2. In a new migration, `delete from public.fsm_edge where machine_id = '…'` and the same for `fsm_state`, then `insert` the full state list and the full edge list. Column order is fixed: states `(machine_id, status)`, edges `(machine_id, from_status, to_status, role)`.
3. Call `fsm_assert_transition` from the RPC that performs the move.
4. If `authenticated` can `update` the status column, add a `before update` trigger that calls `fsm_assert_transition` when `old.status is distinct from new.status`.

The contract test is what makes step 2 mechanical. A wrong tuple fails CI.

### 4.2 Statements the contract test understands

The test reads `supabase/migrations/*.sql` in filename order. It strips `--` line comments and `/* */` block comments, then looks only for `insert` and `delete` statements whose target is `public.fsm_state` or `public.fsm_edge`. `create table`, grants, comments, and `fsm_assert_transition` itself mention those tables and are ignored, because they are not catalog rows. An `insert` or `delete` that is not one of the four shapes below fails the test. State inserts for a machine come before its edge inserts, so the foreign keys hold on a fresh database. The pilot migration is insert-only. A later change to an existing machine is a `delete` of that `machine_id` from both tables, then a full re-insert.

- `insert into public.fsm_state (machine_id, status) values` … tuples `('id', 'status')` … `;`
- `insert into public.fsm_edge (machine_id, from_status, to_status, role) values` … tuples `('id', 'from', 'to', 'role')` … `;`
- `delete from public.fsm_state where machine_id = 'id';`
- `delete from public.fsm_edge where machine_id = 'id';`

Tuples may span lines. Whitespace is insignificant. A role value may be `''`. The comparison set after replay must equal the catalog:

- One state row per `machine.states` entry.
- An edge with no `roles` becomes one row with `role = ''`.
- An edge with roles becomes one row per role, and no `''` row.

## 5. Pilot: admin tasks

Domain edges, unchanged from `AdminTask.ts` and from `admin_task_set_status` in `0145`:

| From | To |
| --- | --- |
| `open` | `in_progress`, `blocked` |
| `in_progress` | `open`, `blocked`, `done` |
| `blocked` | `open`, `in_progress`, `done` |
| `done` | `in_progress`, `archived` |
| `archived` | none |

No roles. Same status stays a no-op: the RPC returns before it writes activity or audit, as it does today.

`admin_task_set_status` keeps its current checks around the graph: authentication, the five-status `invalid_status` guard (`22023`), the assignee-or-creator `forbidden` guard (`42501`), and the missing-row `task_not_found` (`P0002`). It then calls `fsm_assert_transition('admin_task', current, new, null)`.

Error mapping inside that RPC, so existing clients keep their codes:

| `fsm_assert_transition` | RPC raises |
| --- | --- |
| `illegal_transition` | `invalid_transition`, `errcode` `22023` |
| `unknown_state` | `invalid_status`, `errcode` `22023` |
| `forbidden_role` | does not occur; the pilot passes null and every edge is unrestricted |

The new migration replaces `admin_task_set_status` with `create or replace function`. The string-pair `if v_pair not in (...)` block from `0145` is absent from the replacement. The catalog is the list.

`public.admin_tasks_assert_status_transition` is a `before update of status` trigger on `admin_tasks`. When `old.status is distinct from new.status` it calls `fsm_assert_transition('admin_task', old.status, new.status, null)` and lets the fsm error propagate. The RPC's own call runs first and maps the error for clients that use the RPC. A same-status update does not call the assert.

Activity and audit inserts stay in the RPC, after the assert. The kernel does not write them.

## 6. Tests

Domain unit tests, beside the module:

- Every pilot edge is legal. Every other pair of known statuses is `illegal_transition`. `archived → open` is the existing regression.
- Same known status is `{ ok: true, changed: false }`.
- Unknown string is `unknown_state` even when both sides match.
- Role cases on a fixture machine, not on admin tasks: omitted roles allow `undefined`; listed roles allow a member and reject `undefined` and a stranger.
- `defineMachine` rejects an empty state list, a duplicate state, an edge to an unknown status, a duplicate pair, an empty `roles` array, and a repeated role.
- `isTerminal` is true for `archived` and false for `done`.
- Existing `AdminTask` tests pass without changed expectations.

Contract test `app/packages/infrastructure-supabase/src/fsm/__tests__/catalogMatchesSql.test.ts`. It replays the migration statements in §4.2 (parser: `__tests__/support/replayFsmSql.ts`) and compares them to `FSM_MACHINES`. The migrations directory is six levels above that test file (`../../../../../../supabase/migrations`). `FSM_MACHINES` is typed as `readonly FsmMachine<string, string>[]` so the test can walk every machine without a per-machine generic.

SQL test, new file under `supabase/tests/`. Calls to `fsm_assert_transition`:

- `('admin_task', 'open', 'in_progress', null)` does not raise.
- `('admin_task', 'open', 'done', null)` raises `illegal_transition`.
- `('admin_task', 'nope', 'open', null)` raises `unknown_state`.
- `('admin_task', 'open', 'open', null)` returns.
- A role fixture inserted in the test transaction and rolled back, not in a migration: a `''` edge allows a null role; a listed role allows that role and rejects another.
- `authenticated` has no privilege on `fsm_state` or `fsm_edge`.
- `admin_task_set_status` still raises `invalid_transition` for `open → done`, and still returns without an activity row when the status is unchanged.

`pnpm --filter @kc/infrastructure-supabase test` is the gate for the catalog lock; `ci-backend.yml` also runs the contract file directly so a migration-only change cannot hit a cached turbo result. No new npm dependency. No generator.

## 7. Later issues

Open these only after this spec is implemented. Each issue cites this file and migrates one row from §2. None of them change the kernel's answer function. A machine that needs a predicate or a composite state gets its own spec first, and the kernel stays a graph.

The implementation plan for this spec covers §3–§6 only.

## 8. Implementation notes (as shipped)

- **Migration number.** `supabase/migrations/0680_fsm_catalog.sql`, SQL test `supabase/tests/0680_fsm_catalog.sql`, range `0680–0689` in `docs/agents/MIGRATION_RANGES.md`. `0676`–`0679` were taken by demo-data work.
- **Replay parser layer.** The parser that reads `supabase/migrations` is infrastructure tooling, not domain logic. It lives in `@kc/infrastructure-supabase` test support, so `@kc/domain` keeps zero runtime dependencies, needs no `@types/node`, and does not export a SQL parser.
- **`fsm_assert_transition` is `stable`.** It only reads the catalog.
- **Migration order of the remaining machines** is set by `docs/architecture/state-machines.md` (supersedes the unordered list in §2 "Out").
