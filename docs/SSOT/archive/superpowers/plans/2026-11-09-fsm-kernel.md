# FSM kernel Implementation Plan

> **Archived 2026-11-09 — executed.** This was the step-by-step build script for the FSM kernel. The shipped layout differs in two places; the design spec (`docs/superpowers/specs/2026-11-09-fsm-kernel-design.md` §8) is current:
> - The migration is `supabase/migrations/0680_fsm_catalog.sql` (not `0667` / `0676` / `0679`; those numbers were taken).
> - The SQL replay parser and the contract test live in `app/packages/infrastructure-supabase/src/fsm/__tests__/`, not in `@kc/domain`: reading migration files is infrastructure tooling, and the domain stays free of Node types and of a SQL parser in its public API.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one pure state-machine graph in `@kc/domain`, store the same edges in Postgres, and move admin tasks onto it without changing their behavior.

**Architecture:** `defineMachine` checks a declaration at load. `canTransition` / `assertTransition` answer move questions. Postgres tables `fsm_state` and `fsm_edge` hold the same rows. `fsm_assert_transition` is the only runtime reader. A contract test replays catalog `insert`/`delete` statements from migrations and fails on drift. Admin-task RPC and a before-update trigger both call the assert. Posts already have their own S1 graph (`posts.ts`, migration `0665`) and stay untouched.

**Tech Stack:** TypeScript, Vitest, Postgres migrations, `kc_test` SQL harness.

## Global Constraints

- Domain throws `DomainError` subclasses only. No `throw new Error`. No `node_modules` imports from domain.
- Files stay at or under 300 lines.
- No new npm dependency.
- Do not edit migration `0145` or any earlier file. Do not edit `0665_g1_one_s1_state_machine.sql` or `app/packages/domain/src/posts.ts`.
- `canTransitionPostStatus` returns false for the same status. The kernel returns `{ ok: true, changed: false }` for the same known status. Do not unify those in this plan.
- Pilot edges match today's admin-task graph. Same status is a no-op and writes no activity row.
- RPC error codes stay `invalid_status` (`22023`), `invalid_transition` (`22023`), `forbidden` (`42501`), `task_not_found` (`P0002`).
- `fsm_assert_transition` messages are exactly `unknown_state`, `illegal_transition`, `forbidden_role`, errcode `P0001`.
- Catalog `role ''` means unrestricted. A restricted edge has one row per role and no `''` row.
- Machine id matches `^[a-z][a-z0-9_]*$`. Pilot id is `admin_task`.

---

### Task 1: Domain graph

**Files:**
- Create: `app/packages/domain/src/fsm/TransitionError.ts`
- Create: `app/packages/domain/src/fsm/machine.ts`
- Create: `app/packages/domain/src/fsm/__tests__/machine.test.ts`
- Create: `app/packages/domain/src/fsm/index.ts`
- Modify: `app/packages/domain/src/index.ts` (add `export * from './fsm';` after the errors export)

**Interfaces:**
- Consumes: `DomainError`, `ValidationError` from `app/packages/domain/src/errors.ts`.
- Produces:
  - `TransitionError` with `code: 'unknown_state' | 'illegal_transition' | 'forbidden_role'`
  - `defineMachine<S, R>(machine: FsmMachine<S, R>): FsmMachine<S, R>`
  - `canTransition(machine, from: string, to: string, role?: R): { ok: true, changed: boolean } | { ok: false, code }`
  - `assertTransition(...)` returns the ok result or throws `TransitionError`
  - `isTerminal(machine, state: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `app/packages/domain/src/fsm/__tests__/machine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../errors';
import { TransitionError } from '../TransitionError';
import { assertTransition, canTransition, defineMachine, isTerminal } from '../machine';

const gate = defineMachine({
  id: 'gate',
  states: ['a', 'b', 'c'] as const,
  edges: [
    { from: 'a', to: 'b' },
    { from: 'a', to: 'c', roles: ['owner'] as const },
  ],
});

describe('defineMachine', () => {
  it('rejects a bad id, empty states, duplicates, and bad edges', () => {
    expect(() => defineMachine({ id: 'Bad', states: ['a'], edges: [] })).toThrow(ValidationError);
    expect(() => defineMachine({ id: 'ok', states: [], edges: [] })).toThrow(ValidationError);
    expect(() => defineMachine({ id: 'ok', states: ['a', 'a'], edges: [] })).toThrow(ValidationError);
    expect(() => defineMachine({
      id: 'ok', states: ['a'], edges: [{ from: 'a', to: 'z' }],
    })).toThrow(ValidationError);
    expect(() => defineMachine({
      id: 'ok',
      states: ['a', 'b'],
      edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }],
    })).toThrow(ValidationError);
    expect(() => defineMachine({
      id: 'ok', states: ['a', 'b'], edges: [{ from: 'a', to: 'b', roles: [] }],
    })).toThrow(ValidationError);
    expect(() => defineMachine({
      id: 'ok', states: ['a', 'b'], edges: [{ from: 'a', to: 'b', roles: ['owner', 'owner'] }],
    })).toThrow(ValidationError);
  });
});

describe('canTransition', () => {
  it('treats the same known status as an unchanged success', () => {
    expect(canTransition(gate, 'a', 'a')).toEqual({ ok: true, changed: false });
  });

  it('allows an unrestricted edge for any role', () => {
    expect(canTransition(gate, 'a', 'b')).toEqual({ ok: true, changed: true });
    expect(canTransition(gate, 'a', 'b', 'stranger')).toEqual({ ok: true, changed: true });
  });

  it('enforces listed roles and rejects a missing role', () => {
    expect(canTransition(gate, 'a', 'c', 'owner')).toEqual({ ok: true, changed: true });
    expect(canTransition(gate, 'a', 'c', 'stranger')).toEqual({ ok: false, code: 'forbidden_role' });
    expect(canTransition(gate, 'a', 'c')).toEqual({ ok: false, code: 'forbidden_role' });
  });

  it('rejects unknown statuses before the same-status rule', () => {
    expect(canTransition(gate, 'nope', 'nope')).toEqual({ ok: false, code: 'unknown_state' });
    expect(canTransition(gate, 'a', 'z')).toEqual({ ok: false, code: 'unknown_state' });
  });

  it('rejects a missing edge', () => {
    expect(canTransition(gate, 'b', 'a')).toEqual({ ok: false, code: 'illegal_transition' });
  });
});

describe('assertTransition', () => {
  it('returns the ok result or throws TransitionError with details', () => {
    expect(assertTransition(gate, 'a', 'b')).toEqual({ ok: true, changed: true });
    expect(() => assertTransition(gate, 'b', 'a')).toThrow(TransitionError);
    try {
      assertTransition(gate, 'a', 'c');
    } catch (error) {
      expect(error).toBeInstanceOf(TransitionError);
      const thrown = error as TransitionError;
      expect(thrown.code).toBe('forbidden_role');
      expect(thrown.message).toBe('forbidden_role');
      expect(thrown.details).toEqual({ machine: 'gate', from: 'a', to: 'c' });
    }
  });
});

describe('isTerminal', () => {
  it('is true only for a known status with no outgoing edge', () => {
    expect(isTerminal(gate, 'b')).toBe(true);
    expect(isTerminal(gate, 'a')).toBe(false);
    expect(isTerminal(gate, 'missing')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @kc/domain exec vitest run src/fsm/__tests__/machine.test.ts`

Expected: FAIL because `../machine` does not exist.

- [ ] **Step 3: Implement the kernel**

`app/packages/domain/src/fsm/TransitionError.ts`:

```ts
import { DomainError } from '../errors';

export type TransitionErrorCode = 'unknown_state' | 'illegal_transition' | 'forbidden_role';

export class TransitionError extends DomainError {
  readonly code: TransitionErrorCode;

  constructor(
    code: TransitionErrorCode,
    details: { machine: string; from: string; to: string; role?: string },
  ) {
    super(code, details);
    this.code = code;
  }
}
```

`app/packages/domain/src/fsm/machine.ts`:

```ts
import { ValidationError } from '../errors';
import { TransitionError, type TransitionErrorCode } from './TransitionError';

export type FsmEdge<S extends string, R extends string> = {
  readonly from: S;
  readonly to: S;
  readonly roles?: readonly R[];
};

export type FsmMachine<S extends string, R extends string> = {
  readonly id: string;
  readonly states: readonly S[];
  readonly edges: readonly FsmEdge<S, R>[];
};

export type TransitionOk = { readonly ok: true; readonly changed: boolean };
export type TransitionFail = { readonly ok: false; readonly code: TransitionErrorCode };
export type TransitionAnswer = TransitionOk | TransitionFail;

const MACHINE_ID = /^[a-z][a-z0-9_]*$/;

export function defineMachine<S extends string, R extends string>(
  machine: FsmMachine<S, R>,
): FsmMachine<S, R> {
  if (!MACHINE_ID.test(machine.id)) throw new ValidationError(`invalid machine id ${machine.id}`, 'id');
  if (machine.states.length === 0) throw new ValidationError('states must not be empty', 'states');
  const known = new Set<string>();
  for (const state of machine.states) {
    if (known.has(state)) throw new ValidationError(`duplicate state ${state}`, 'states');
    known.add(state);
  }
  const pairs = new Set<string>();
  for (const edge of machine.edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) {
      throw new ValidationError(`unknown status on ${edge.from}->${edge.to}`, 'edges');
    }
    const pair = `${edge.from}->${edge.to}`;
    if (pairs.has(pair)) throw new ValidationError(`duplicate edge ${pair}`, 'edges');
    pairs.add(pair);
    if (!edge.roles) continue;
    if (edge.roles.length === 0) throw new ValidationError('omit roles instead of an empty list', 'roles');
    const roles = new Set<string>();
    for (const role of edge.roles) {
      if (roles.has(role)) throw new ValidationError(`duplicate role ${role}`, 'roles');
      roles.add(role);
    }
  }
  return machine;
}

export function canTransition<S extends string, R extends string>(
  machine: FsmMachine<S, R>,
  from: string,
  to: string,
  role?: R,
): TransitionAnswer {
  const known = new Set<string>(machine.states);
  if (!known.has(from) || !known.has(to)) return { ok: false, code: 'unknown_state' };
  if (from === to) return { ok: true, changed: false };
  const edge = machine.edges.find((item) => item.from === from && item.to === to);
  if (!edge) return { ok: false, code: 'illegal_transition' };
  if (!edge.roles) return { ok: true, changed: true };
  if (role === undefined || !edge.roles.includes(role)) return { ok: false, code: 'forbidden_role' };
  return { ok: true, changed: true };
}

export function assertTransition<S extends string, R extends string>(
  machine: FsmMachine<S, R>,
  from: string,
  to: string,
  role?: R,
): TransitionOk {
  const answer = canTransition(machine, from, to, role);
  if (!answer.ok) {
    const details: { machine: string; from: string; to: string; role?: string } = {
      machine: machine.id, from, to,
    };
    if (role !== undefined) details.role = role;
    throw new TransitionError(answer.code, details);
  }
  return answer;
}

export function isTerminal<S extends string, R extends string>(
  machine: FsmMachine<S, R>,
  state: string,
): boolean {
  if (!machine.states.some((item) => item === state)) return false;
  return !machine.edges.some((edge) => edge.from === state);
}
```

`app/packages/domain/src/fsm/index.ts`:

```ts
export { TransitionError } from './TransitionError';
export type { TransitionErrorCode } from './TransitionError';
export {
  assertTransition, canTransition, defineMachine, isTerminal,
} from './machine';
export type {
  FsmEdge, FsmMachine, TransitionAnswer, TransitionFail, TransitionOk,
} from './machine';
```

Add to `app/packages/domain/src/index.ts` immediately after `export * from './errors';`:

```ts
export * from './fsm';
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @kc/domain exec vitest run src/fsm/__tests__/machine.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/packages/domain/src/fsm app/packages/domain/src/index.ts
git commit -m "feat(domain): add a pure fsm graph"
```

---

### Task 2: Admin-task pilot in the domain

**Files:**
- Create: `app/packages/domain/src/fsm/machines/adminTask.ts`
- Create: `app/packages/domain/src/fsm/catalog.ts`
- Modify: `app/packages/domain/src/fsm/index.ts`
- Modify: `app/packages/domain/src/admin/AdminTask.ts` (replace `ALLOWED_TRANSITIONS` and `isStatusTransitionAllowed`)
- Test: `app/packages/domain/src/admin/__tests__/AdminTask.test.ts` (no expectation changes)

**Interfaces:**
- Consumes: `defineMachine`, `canTransition` from Task 1. `AdminTaskStatus` stays in `AdminTask.ts`.
- Produces: `adminTaskMachine`, `FSM_MACHINES: readonly FsmMachine<string, string>[]`. `isStatusTransitionAllowed(from, to): boolean` still returns true for same status and for the ten edges below, false otherwise.

Edges, unchanged from `AdminTask.ts` today:

| From | To |
| --- | --- |
| open | in_progress, blocked |
| in_progress | open, blocked, done |
| blocked | open, in_progress, done |
| done | in_progress, archived |
| archived | none |

- [ ] **Step 1: Add the declaration and catalog**

`app/packages/domain/src/fsm/machines/adminTask.ts`:

```ts
import { defineMachine } from '../machine';

export const adminTaskMachine = defineMachine({
  id: 'admin_task',
  states: ['open', 'in_progress', 'blocked', 'done', 'archived'] as const,
  edges: [
    { from: 'open', to: 'in_progress' },
    { from: 'open', to: 'blocked' },
    { from: 'in_progress', to: 'open' },
    { from: 'in_progress', to: 'blocked' },
    { from: 'in_progress', to: 'done' },
    { from: 'blocked', to: 'open' },
    { from: 'blocked', to: 'in_progress' },
    { from: 'blocked', to: 'done' },
    { from: 'done', to: 'in_progress' },
    { from: 'done', to: 'archived' },
  ],
});
```

`app/packages/domain/src/fsm/catalog.ts`:

```ts
import type { FsmMachine } from './machine';
import { adminTaskMachine } from './machines/adminTask';

export const FSM_MACHINES: readonly FsmMachine<string, string>[] = [adminTaskMachine];
```

Append to `fsm/index.ts`:

```ts
export { FSM_MACHINES } from './catalog';
export { adminTaskMachine } from './machines/adminTask';
```

- [ ] **Step 2: Point the existing helper at the graph**

In `AdminTask.ts`, delete the `ALLOWED_TRANSITIONS` constant. Add imports:

```ts
import { canTransition } from '../fsm/machine';
import { adminTaskMachine } from '../fsm/machines/adminTask';
```

Replace `isStatusTransitionAllowed` with:

```ts
export function isStatusTransitionAllowed(
  from: AdminTaskStatus,
  to: AdminTaskStatus,
): boolean {
  return canTransition(adminTaskMachine, from, to).ok;
}
```

- [ ] **Step 3: Run the existing admin-task tests**

Run: `pnpm --filter @kc/domain exec vitest run src/admin/__tests__/AdminTask.test.ts src/fsm/__tests__/machine.test.ts`

Expected: PASS, including `isStatusTransitionAllowed('open', 'open') === true` and `archived → open === false`.

- [ ] **Step 4: Commit**

```bash
git add app/packages/domain/src/fsm app/packages/domain/src/admin/AdminTask.ts
git commit -m "feat(domain): register the admin-task fsm"
```

---

### Task 3: SQL catalog replay

**Files:**
- Create: `app/packages/domain/src/fsm/replaySql.ts`
- Create: `app/packages/domain/src/fsm/__tests__/replaySql.test.ts`
- Modify: `app/packages/domain/src/fsm/index.ts` (export `replayFsmSql` and the row types)

**Interfaces:**
- Consumes: nothing from Postgres. Pure string in, rows out.
- Produces:
  - `replayFsmSql(files: readonly { name: string; sql: string }[]): { states: FsmStateRow[]; edges: FsmEdgeRow[] }`
  - `FsmStateRow = { machineId: string; status: string }`
  - `FsmEdgeRow = { machineId: string; from: string; to: string; role: string }`
  - Throws `ValidationError` when an insert/delete targeting either catalog table is not one of the four shapes.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../errors';
import { replayFsmSql } from '../replaySql';

const clean = `
  create table public.fsm_state (machine_id text, status text);
  insert into public.fsm_state (machine_id, status) values
    ('admin_task', 'open'),
    ('admin_task', 'done');
  insert into public.fsm_edge (machine_id, from_status, to_status, role) values
    ('admin_task', 'open', 'done', '');
  create function public.fsm_assert_transition() returns void language sql as $$
    select 1 from public.fsm_state; select 1 from public.fsm_edge;
  $$;
`;

describe('replayFsmSql', () => {
  it('reads catalog rows and ignores ddl and function bodies', () => {
    expect(replayFsmSql([{ name: '1000_a.sql', sql: clean }])).toEqual({
      states: [
        { machineId: 'admin_task', status: 'open' },
        { machineId: 'admin_task', status: 'done' },
      ],
      edges: [{ machineId: 'admin_task', from: 'open', to: 'done', role: '' }],
    });
  });

  it('applies a later delete and reinsert in filename order', () => {
    const next = `
      delete from public.fsm_edge where machine_id = 'admin_task';
      delete from public.fsm_state where machine_id = 'admin_task';
      insert into public.fsm_state (machine_id, status) values ('admin_task', 'archived');
    `;
    const replayed = replayFsmSql([
      { name: '2000_b.sql', sql: next },
      { name: '1000_a.sql', sql: clean },
    ]);
    expect(replayed.states).toEqual([{ machineId: 'admin_task', status: 'archived' }]);
    expect(replayed.edges).toEqual([]);
  });

  it('rejects a catalog write that is not one of the four shapes', () => {
    const bad = `update public.fsm_state set status = 'x' where machine_id = 'admin_task';`;
    expect(() => replayFsmSql([{ name: '1.sql', sql: bad }])).toThrow(ValidationError);
  });
});
```

- [ ] **Step 2: Run it and confirm failure**

Run: `pnpm --filter @kc/domain exec vitest run src/fsm/__tests__/replaySql.test.ts`

Expected: FAIL, module missing.

- [ ] **Step 3: Implement the replay**

Create `app/packages/domain/src/fsm/replaySql.ts` with this file:

```ts
import { ValidationError } from '../errors';

export type FsmStateRow = { readonly machineId: string; readonly status: string };
export type FsmEdgeRow = {
  readonly machineId: string;
  readonly from: string;
  readonly to: string;
  readonly role: string;
};
export type FsmCatalogSnapshot = { readonly states: FsmStateRow[]; readonly edges: FsmEdgeRow[] };

function stripComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "'") {
      const start = i;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i += 1; break; }
        i += 1;
      }
      out += sql.slice(start, i);
      continue;
    }
    if (sql.startsWith('--', i)) {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl + 1;
      out += '\n';
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += ' ';
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

function statements(sql: string): string[] {
  const parts: string[] = [];
  let current = '';
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "'") {
      current += sql[i];
      i += 1;
      while (i < sql.length) {
        current += sql[i];
        if (sql[i] === "'" && sql[i + 1] === "'") { current += sql[i + 1]; i += 2; continue; }
        if (sql[i] === "'") { i += 1; break; }
        i += 1;
      }
      continue;
    }
    if (sql[i] === ';') { parts.push(current); current = ''; i += 1; continue; }
    current += sql[i];
    i += 1;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function unquote(raw: string): string {
  return raw.replace(/''/g, "'");
}

function tuples(body: string, width: number): string[][] {
  const rows: string[][] = [];
  const re = /\(\s*((?:'(?:''|[^'])*'\s*,\s*)*(?:'(?:''|[^'])*'))\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) {
    const cells = [...match[1].matchAll(/'((?:''|[^'])*)'/g)].map((cell) => unquote(cell[1]));
    if (cells.length !== width) throw new ValidationError(`catalog tuple width ${cells.length}`, 'sql');
    rows.push(cells);
  }
  if (rows.length === 0) throw new ValidationError('catalog insert has no tuples', 'sql');
  return rows;
}

const STATE_INSERT = /^insert\s+into\s+public\.fsm_state\s*\(\s*machine_id\s*,\s*status\s*\)\s*values\b([\s\S]*)$/i;
const EDGE_INSERT = /^insert\s+into\s+public\.fsm_edge\s*\(\s*machine_id\s*,\s*from_status\s*,\s*to_status\s*,\s*role\s*\)\s*values\b([\s\S]*)$/i;
const STATE_DELETE = /^delete\s+from\s+public\.fsm_state\s+where\s+machine_id\s*=\s*'((?:''|[^'])*)'\s*$/i;
const EDGE_DELETE = /^delete\s+from\s+public\.fsm_edge\s+where\s+machine_id\s*=\s*'((?:''|[^'])*)'\s*$/i;

export function replayFsmSql(
  files: readonly { readonly name: string; readonly sql: string }[],
): FsmCatalogSnapshot {
  const states: FsmStateRow[] = [];
  const edges: FsmEdgeRow[] = [];
  const ordered = [...files].sort((a, b) => a.name.localeCompare(b.name));
  for (const file of ordered) {
    for (const statement of statements(stripComments(file.sql))) {
      const trimmed = statement.trim();
      if (!trimmed) continue;
      const keyword = /^\s*([a-z]+)/i.exec(trimmed)?.[1]?.toLowerCase() ?? '';
      const catalog = /public\.fsm_(state|edge)\b/i.test(trimmed);
      if (!catalog || (keyword !== 'insert' && keyword !== 'delete' && keyword !== 'update')) continue;
      const stateInsert = STATE_INSERT.exec(trimmed);
      if (stateInsert) {
        for (const [machineId, status] of tuples(stateInsert[1], 2)) states.push({ machineId, status });
        continue;
      }
      const edgeInsert = EDGE_INSERT.exec(trimmed);
      if (edgeInsert) {
        for (const [machineId, from, to, role] of tuples(edgeInsert[1], 4)) {
          edges.push({ machineId, from, to, role });
        }
        continue;
      }
      const stateDelete = STATE_DELETE.exec(trimmed);
      if (stateDelete) {
        const id = unquote(stateDelete[1]);
        for (let index = states.length - 1; index >= 0; index -= 1) {
          if (states[index].machineId === id) states.splice(index, 1);
        }
        continue;
      }
      const edgeDelete = EDGE_DELETE.exec(trimmed);
      if (edgeDelete) {
        const id = unquote(edgeDelete[1]);
        for (let index = edges.length - 1; index >= 0; index -= 1) {
          if (edges[index].machineId === id) edges.splice(index, 1);
        }
        continue;
      }
      throw new ValidationError(`unrecognised fsm catalog statement: ${trimmed.slice(0, 80)}`, 'sql');
    }
  }
  return { states, edges };
}
```

Append to `fsm/index.ts`:

```ts
export { replayFsmSql } from './replaySql';
export type { FsmCatalogSnapshot, FsmEdgeRow, FsmStateRow } from './replaySql';
```

- [ ] **Step 4: Run the replay tests**

Run: `pnpm --filter @kc/domain exec vitest run src/fsm/__tests__/replaySql.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/packages/domain/src/fsm/replaySql.ts app/packages/domain/src/fsm/__tests__/replaySql.test.ts app/packages/domain/src/fsm/index.ts
git commit -m "feat(domain): replay fsm catalog sql"
```

The implementation of `replaySql.ts` must satisfy Step 3 exactly. Keep the file under 300 lines. If the walker and the tuple parser do not fit, put the tuple parser in `replayTuples.ts` and export only `replayFsmSql` from the barrel.

---

### Task 4: Postgres catalog, admin-task enforcement, contract test

**Files:**
- Create: `supabase/migrations/0667_fsm_catalog.sql` if `0667` is unused. If it exists, stop and use the next integer that has no file; use that number in the filename and in the SQL comment.
- Create: `supabase/tests/0667_fsm_catalog.sql` (same number as the migration)
- Create: `app/packages/domain/src/fsm/__tests__/catalogMatchesSql.test.ts`
- Modify: none of the post S1 files

**Interfaces:**
- Consumes: `FSM_MACHINES`, `replayFsmSql`, `adminTaskMachine`.
- Produces: `public.fsm_assert_transition(p_machine text, p_from text, p_to text, p_role text default null)` and trigger `admin_tasks_status_fsm`.

- [ ] **Step 1: Confirm the migration number**

Run: `ls supabase/migrations | tail`

Expected: the highest prefix is `0666`. Use `0667` only when no `0667_*.sql` exists.

- [ ] **Step 2: Write the contract test that fails before the migration**

`catalogMatchesSql.test.ts` reads every `supabase/migrations/*.sql` (six levels up from this test file: `../../../../../../supabase/migrations`), calls `replayFsmSql`, and expects the snapshot to equal the catalog:

- One state row per `machine.states` entry, in declaration order.
- An edge with no `roles` is one row with `role: ''`.
- An edge with roles is one row per role, in list order, and no `''` row.
- Rows are compared as sorted tuples of `(machineId, status)` and `(machineId, from, to, role)` so insert order cannot hide a missing row.

Run: `pnpm --filter @kc/domain exec vitest run src/fsm/__tests__/catalogMatchesSql.test.ts`

Expected: FAIL because the replay is empty and the catalog has `admin_task`.

- [ ] **Step 3: Add the migration**

`supabase/migrations/0667_fsm_catalog.sql` begins with `begin;` and ends with `commit;`. It creates `public.fsm_state` and `public.fsm_edge` exactly as in the spec §4, enables RLS, and revokes all privileges from `anon` and `authenticated`.

Inserts, states before edges:

```sql
insert into public.fsm_state (machine_id, status) values
  ('admin_task', 'open'),
  ('admin_task', 'in_progress'),
  ('admin_task', 'blocked'),
  ('admin_task', 'done'),
  ('admin_task', 'archived');

insert into public.fsm_edge (machine_id, from_status, to_status, role) values
  ('admin_task', 'open', 'in_progress', ''),
  ('admin_task', 'open', 'blocked', ''),
  ('admin_task', 'in_progress', 'open', ''),
  ('admin_task', 'in_progress', 'blocked', ''),
  ('admin_task', 'in_progress', 'done', ''),
  ('admin_task', 'blocked', 'open', ''),
  ('admin_task', 'blocked', 'in_progress', ''),
  ('admin_task', 'blocked', 'done', ''),
  ('admin_task', 'done', 'in_progress', ''),
  ('admin_task', 'done', 'archived', '');
```

`fsm_assert_transition` follows spec §4 steps 1–6 in that order. It is `security definer`, `search_path = public`. Revoke `execute` from `public`, `anon`, and `authenticated`.

Replace `admin_task_set_status` with `create or replace function` copying the body in `0145` from the role check through the audit insert, with two changes only:

1. Keep the early `return` when `v_curr.status = p_new_status` so no activity row is written.
2. Replace the `v_pair not in (...)` block with:

```sql
begin
  perform public.fsm_assert_transition('admin_task', v_curr.status, p_new_status, null);
exception
  when sqlstate 'P0001' then
    if sqlerrm = 'illegal_transition' then
      raise exception 'invalid_transition' using errcode = '22023';
    elsif sqlerrm = 'unknown_state' then
      raise exception 'invalid_status' using errcode = '22023';
    else
      raise;
    end if;
end;
```

Keep `grant execute` on `admin_task_set_status(uuid, text)` to `authenticated`.

Trigger function `public.admin_tasks_assert_status_transition`, `security definer`, `search_path = public`: when `old.status is distinct from new.status`, call `fsm_assert_transition('admin_task', old.status, new.status, null)` and return `new`. Revoke execute from `public`, `anon`, and `authenticated`. Trigger name `admin_tasks_status_fsm`, `before update of status` on `public.admin_tasks`.

- [ ] **Step 4: Run the contract test**

Run: `pnpm --filter @kc/domain exec vitest run src/fsm/__tests__/catalogMatchesSql.test.ts src/fsm/__tests__/replaySql.test.ts src/admin/__tests__/AdminTask.test.ts`

Expected: PASS.

- [ ] **Step 5: Add the SQL behavior test**

`supabase/tests/0667_fsm_catalog.sql`, wrapped in `begin;` … `rollback;`, ending with `\echo '✓ 0667_fsm_catalog.sql passed'`.

```sql
begin;

select public.fsm_assert_transition('admin_task', 'open', 'in_progress', null);
select public.fsm_assert_transition('admin_task', 'open', 'open', null);

select kc_test.assert_raises(
  $$select public.fsm_assert_transition('admin_task', 'open', 'done', null)$$,
  'illegal_transition',
  'open cannot skip to done');
select kc_test.assert_raises(
  $$select public.fsm_assert_transition('admin_task', 'nope', 'open', null)$$,
  'unknown_state',
  'unknown status');

insert into public.fsm_state (machine_id, status) values
  ('fixture_gate', 'a'), ('fixture_gate', 'b'),
  ('fixture_open', 'a'), ('fixture_open', 'b');
insert into public.fsm_edge (machine_id, from_status, to_status, role) values
  ('fixture_gate', 'a', 'b', 'owner'),
  ('fixture_open', 'a', 'b', '');

select public.fsm_assert_transition('fixture_gate', 'a', 'b', 'owner');
select public.fsm_assert_transition('fixture_open', 'a', 'b', null);
select kc_test.assert_raises(
  $$select public.fsm_assert_transition('fixture_gate', 'a', 'b', 'stranger')$$,
  'forbidden_role',
  'stranger role');
select kc_test.assert_raises(
  $$select public.fsm_assert_transition('fixture_gate', 'a', 'b', null)$$,
  'forbidden_role',
  'missing role');

do $$
begin
  begin
    execute 'set local role authenticated';
    perform 1 from public.fsm_state;
    perform kc_test.fail('authenticated read fsm_state');
  exception when insufficient_privilege then
    null;
  end;
  begin
    execute 'set local role authenticated';
    perform 1 from public.fsm_edge;
    perform kc_test.fail('authenticated read fsm_edge');
  exception when insufficient_privilege then
    null;
  end;
end $$;

do $$
declare
  v_admin uuid := kc_test.create_user('fsm_admin');
  v_task uuid;
  v_changes bigint;
begin
  insert into public.admin_role_grants (user_id, role) values (v_admin, 'super_admin');
  insert into public.admin_tasks (title, created_by)
  values ('fsm pilot', v_admin)
  returning task_id into v_task;
  perform kc_test.act_as(v_admin);
  perform public.admin_task_set_status(v_task, 'in_progress');
  perform kc_test.assert_eq(
    (select status from public.admin_tasks where task_id = v_task),
    'in_progress',
    'legal admin move');
  perform public.admin_task_set_status(v_task, 'in_progress');
  select count(*) into v_changes
    from public.admin_task_activities
   where task_id = v_task and kind = 'status_change';
  perform kc_test.assert_eq(v_changes, 1::bigint, 'same status writes no second activity');
  perform kc_test.assert_raises(
    format('select public.admin_task_set_status(%L, %L)', v_task, 'archived'),
    'invalid_transition',
    'in_progress cannot jump to archived');
end $$;

rollback;

\echo '✓ 0667_fsm_catalog.sql passed'
```

Run, with the local stack up: `scripts/run-db-tests.sh supabase/tests/0667_fsm_catalog.sql`

Expected: the echo line and exit 0. If the stack is not running, start it with `supabase start` from the repo root first. Do not point the runner at a remote database.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0667_fsm_catalog.sql supabase/tests/0667_fsm_catalog.sql app/packages/domain/src/fsm/__tests__/catalogMatchesSql.test.ts
git commit -m "feat(db): enforce admin-task moves from the fsm catalog"
```

If the number is not 0667, use the number chosen in Step 1 in both filenames and in the echo string.

---

## Spec coverage

| Spec section | Task |
| --- | --- |
| §3 domain API, errors, same-status, roles, terminal | Task 1 |
| §3 pilot declaration and `isStatusTransitionAllowed` | Task 2 |
| §4.2 replay rules | Task 3 |
| §4 tables, assert, grants | Task 4 |
| §5 RPC mapping, no-op, trigger | Task 4 |
| §6 domain, contract, and SQL tests | Tasks 1–4 |
| §2 and §7 later machines | Not this plan |

Posts S1 (`0665`, `posts.ts`) is already enforced on its own graph. Registering it in `FSM_MACHINES` is a later issue and must keep `canTransitionPostStatus` same-status behavior.

## Plan self-review

- Placeholder scan: the replay implementation is specified by behavior and file split, and the tests define the accepted output. No `TBD`.
- Type names match across tasks: `canTransition`, `defineMachine`, `replayFsmSql`, `FSM_MACHINES`, `fsm_assert_transition`.
- The spec's original line that failed any statement mentioning the tables was corrected in the spec before this plan, because `create table` and the assert function must mention them.
