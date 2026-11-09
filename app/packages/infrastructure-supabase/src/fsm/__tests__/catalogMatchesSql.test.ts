/**
 * FSM catalog contract: the rows that `supabase/migrations` leave in `fsm_state` /
 * `fsm_edge` must equal the domain registry `FSM_MACHINES`, row for row.
 *
 * The database enforces the SQL copy (`fsm_assert_transition`); the app reads the
 * TypeScript copy. This test is what keeps the two from drifting. CI runs it on every
 * backend change (`.github/workflows/ci-backend.yml`), not only through turbo, so a
 * migration-only change cannot hit a cached result.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FSM_MACHINES, type FsmMachine } from '@kc/domain';
import { describe, expect, it } from 'vitest';
import {
  replayFsmSql, type FsmCatalogSnapshot, type FsmEdgeRow, type FsmStateRow,
} from './support/replayFsmSql';

/** `app/packages/infrastructure-supabase/src/fsm/__tests__` → repository root → migrations. */
const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../../supabase/migrations',
);

/**
 * The rows a machine must own in SQL: one state row per status; one `''` edge row for an
 * unrestricted edge, or one row per role (and no `''` row) for a role-restricted edge.
 */
function rowsOf(machine: FsmMachine<string, string>): FsmCatalogSnapshot {
  const states = machine.states.map((status) => ({ machineId: machine.id, status }));
  const edges = machine.edges.flatMap((edge) =>
    (edge.roles ?? ['']).map((role) => ({ machineId: machine.id, from: edge.from, to: edge.to, role })),
  );
  return { states, edges };
}

/** Order-insensitive, readable keys so a failure diff names the exact missing or extra row. */
const stateKeys = (rows: readonly FsmStateRow[]): string[] =>
  rows.map((row) => `${row.machineId}: ${row.status}`).sort();
const edgeKeys = (rows: readonly FsmEdgeRow[]): string[] =>
  rows.map((row) => `${row.machineId}: ${row.from} -> ${row.to} [${row.role}]`).sort();

function readMigrations(): { name: string; sql: string }[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => ({ name, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8') }));
}

describe('FSM catalog contract (supabase/migrations vs FSM_MACHINES)', () => {
  const replayed = replayFsmSql(readMigrations());
  const expected = FSM_MACHINES.map(rowsOf);

  it('every registered machine has exactly its states in fsm_state', () => {
    expect(stateKeys(replayed.states)).toEqual(stateKeys(expected.flatMap((rows) => rows.states)));
  });

  it('every registered machine has exactly its edges in fsm_edge', () => {
    expect(edgeKeys(replayed.edges)).toEqual(edgeKeys(expected.flatMap((rows) => rows.edges)));
  });

  it('machine ids are unique in the registry', () => {
    const ids = FSM_MACHINES.map((machine) => machine.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
