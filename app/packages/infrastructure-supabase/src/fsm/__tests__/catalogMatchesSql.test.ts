/**
 * FSM catalog contract: the rows that the production baseline (`supabase/schemas/**`) and
 * the forward migrations after it (`supabase/migrations/0002…`) seed into
 * `kc_private.fsm_state` / `fsm_edge` must equal the domain registry `FSM_MACHINES`, row
 * for row.
 *
 * The database enforces the SQL copy (`kc_private.fsm_assert_transition`); the app reads the
 * TypeScript copy. This test is what keeps the two from drifting. CI runs it on every
 * backend change, not only through turbo, so a schema-only change cannot hit a cached result.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FSM_MACHINES, type FsmMachine } from '@kc/domain';
import { describe, expect, it } from 'vitest';
import {
  readBaselineFsmSeeds, type FsmCatalogSnapshot, type FsmEdgeRow, type FsmStateRow, type SchemaFile,
} from './support/readBaselineFsmSeeds';

/** `app/packages/infrastructure-supabase/src/fsm/__tests__` → repository root → baseline sources. */
const SCHEMAS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../../supabase/schemas',
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

/** Every `.sql` file under `supabase/schemas`, named by its path relative to it. */
function readSchemaFiles(dir: string = SCHEMAS_DIR, prefix = ''): SchemaFile[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) return readSchemaFiles(path.join(dir, entry.name), `${name}/`);
    return entry.name.endsWith('.sql') ? [{ name, sql: fs.readFileSync(path.join(dir, entry.name), 'utf8') }] : [];
  });
}

/** `supabase/migrations`, beside the schema sources. */
const MIGRATIONS_DIR = path.resolve(SCHEMAS_DIR, '../migrations');
/** The generated baseline: the schema sources assembled, so it is not replayed twice. */
const BASELINE_MIGRATION = '0001_baseline.sql';

/**
 * The forward migrations after the baseline, in order. The baseline is frozen, so a machine
 * added later is seeded here. The name prefix sorts them after every schema file.
 */
function readForwardMigrations(): SchemaFile[] {
  return fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d{4}_.+\.sql$/.test(entry.name) && entry.name !== BASELINE_MIGRATION)
    .map((entry) => ({
      name: `~migrations/${entry.name}`,
      sql: fs.readFileSync(path.join(MIGRATIONS_DIR, entry.name), 'utf8'),
    }));
}

describe('FSM catalog contract (supabase/schemas and forward migrations vs FSM_MACHINES)', () => {
  const replayed = readBaselineFsmSeeds([...readSchemaFiles(), ...readForwardMigrations()]);
  const expected = FSM_MACHINES.map(rowsOf);

  it('every registered machine has exactly its states in fsm_state', () => {
    expect(stateKeys(replayed.states)).toEqual(stateKeys(expected.flatMap((rows) => rows.states)));
  });

  it('every registered machine has exactly its edges in fsm_edge', () => {
    expect(edgeKeys(replayed.edges)).toEqual(edgeKeys(expected.flatMap((rows) => rows.edges)));
  });

  it('the baseline seeds at least the machines the app relies on', () => {
    const ids = new Set(replayed.states.map((row) => row.machineId));
    for (const id of ['post', 'giving_handoff', 'account_status', 'onboarding', 'report']) expect(ids).toContain(id);
  });

  it('machine ids are unique in the registry', () => {
    const ids = FSM_MACHINES.map((machine) => machine.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
