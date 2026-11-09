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
