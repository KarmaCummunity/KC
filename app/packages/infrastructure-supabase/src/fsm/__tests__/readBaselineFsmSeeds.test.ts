import { describe, expect, it } from 'vitest';
import { ValidationError } from '@kc/domain';
import { readBaselineFsmSeeds } from './support/readBaselineFsmSeeds';

const plain = `
  -- a comment that mentions kc_private.fsm_state is ignored
  insert into kc_private.fsm_state (machine_id, status) values
    ('follow_request', 'pending'), ('follow_request', 'accepted');
  insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
    ('follow_request', 'pending', 'accepted', 'target'),
    ('follow_request', 'accepted', 'pending', '');
  create function kc_private.f() returns void language sql as $$
    select 1 from kc_private.fsm_state; select 1 from kc_private.fsm_edge;
  $$;
`;

const arrays = `
  insert into kc_private.fsm_state (machine_id, status)
  select m.machine_id, s.status
    from (values ('giving', array['reserved', 'done'])) as m (machine_id, statuses),
         unnest(m.statuses) as s (status);
  insert into kc_private.fsm_edge (machine_id, from_status, to_status, role)
  select e.machine_id, e.from_status, e.to_status, r.role
    from (values ('giving', 'reserved', 'done', array['owner', 'system'])) as e (machine_id, from_status, to_status, roles),
         unnest(e.roles) as r (role);
  insert into kc_private.fsm_edge (machine_id, from_status, to_status) values ('giving', 'done', 'reserved');
`;

describe('readBaselineFsmSeeds', () => {
  it('reads literal tuples and ignores comments, ddl and function bodies', () => {
    expect(readBaselineFsmSeeds([{ name: 'a.sql', sql: plain }])).toEqual({
      states: [
        { machineId: 'follow_request', status: 'pending' },
        { machineId: 'follow_request', status: 'accepted' },
      ],
      edges: [
        { machineId: 'follow_request', from: 'pending', to: 'accepted', role: 'target' },
        { machineId: 'follow_request', from: 'accepted', to: 'pending', role: '' },
      ],
    });
  });

  it('expands state arrays and role arrays, and reads a role-less edge as unrestricted', () => {
    const { states, edges } = readBaselineFsmSeeds([{ name: 'a.sql', sql: arrays }]);
    expect(states.map((row) => row.status)).toEqual(['reserved', 'done']);
    expect(edges.map((row) => `${row.from}>${row.to}[${row.role}]`)).toEqual([
      'reserved>done[owner]',
      'reserved>done[system]',
      'done>reserved[]',
    ]);
  });

  it('reads files in path order', () => {
    const late = "insert into kc_private.fsm_state (machine_id, status) values ('b', 'x');";
    const early = "insert into kc_private.fsm_state (machine_id, status) values ('a', 'x');";
    const { states } = readBaselineFsmSeeds([{ name: '20/b.sql', sql: late }, { name: '10/a.sql', sql: early }]);
    expect(states.map((row) => row.machineId)).toEqual(['a', 'b']);
  });

  it('throws on a write it cannot read instead of ignoring it', () => {
    for (const sql of [
      "delete from kc_private.fsm_edge where machine_id = 'x';",
      "update kc_private.fsm_state set status = 'y';",
      'insert into kc_private.fsm_state (machine_id, status) select machine_id, status from other;',
    ]) {
      expect(() => readBaselineFsmSeeds([{ name: 'a.sql', sql }])).toThrow(ValidationError);
    }
  });
});
