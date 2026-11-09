import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FSM_MACHINES } from '../catalog';
import type { FsmMachine } from '../machine';
import { replayFsmSql, type FsmEdgeRow, type FsmStateRow } from '../replaySql';

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../../supabase/migrations',
);

function catalogFromMachine(machine: FsmMachine<string, string>): {
  states: FsmStateRow[];
  edges: FsmEdgeRow[];
} {
  const states = machine.states.map((status) => ({ machineId: machine.id, status }));
  const edges = machine.edges.flatMap((edge) => {
    if (!edge.roles) {
      return [{ machineId: machine.id, from: edge.from, to: edge.to, role: '' }];
    }
    return edge.roles.map((role) => ({
      machineId: machine.id,
      from: edge.from,
      to: edge.to,
      role,
    }));
  });
  return { states, edges };
}

function sortStates(rows: readonly FsmStateRow[]): string[] {
  return rows.map((row) => `${row.machineId}\0${row.status}`).sort();
}

function sortEdges(rows: readonly FsmEdgeRow[]): string[] {
  return rows
    .map((row) => `${row.machineId}\0${row.from}\0${row.to}\0${row.role}`)
    .sort();
}

describe('catalogMatchesSql', () => {
  it('replayed migrations match FSM_MACHINES', () => {
    const files = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => ({
        name,
        sql: fs.readFileSync(path.join(migrationsDir, name), 'utf8'),
      }));

    const replayed = replayFsmSql(files);

    const expectedStates: FsmStateRow[] = [];
    const expectedEdges: FsmEdgeRow[] = [];
    for (const machine of FSM_MACHINES) {
      const part = catalogFromMachine(machine);
      expectedStates.push(...part.states);
      expectedEdges.push(...part.edges);
    }

    expect(sortStates(replayed.states)).toEqual(sortStates(expectedStates));
    expect(sortEdges(replayed.edges)).toEqual(sortEdges(expectedEdges));
  });
});
