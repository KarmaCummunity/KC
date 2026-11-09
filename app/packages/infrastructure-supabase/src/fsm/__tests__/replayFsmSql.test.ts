import { describe, expect, it } from 'vitest';
import { ValidationError } from '@kc/domain';
import { replayFsmSql } from './support/replayFsmSql';

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

  const reject = (sql: string) =>
    expect(() => replayFsmSql([{ name: '1.sql', sql }])).toThrow(ValidationError);

  it.each([
    ['default', "insert into public.fsm_state (machine_id, status) values ('admin_task', default);"],
    ['number', "insert into public.fsm_state (machine_id, status) values ('admin_task', 1);"],
    ['null', "insert into public.fsm_state (machine_id, status) values ('admin_task', null);"],
    [
      'mixed list',
      "insert into public.fsm_state (machine_id, status) values ('admin_task', 'open'), ('admin_task', default);",
    ],
  ])('rejects a non-literal tuple (%s) instead of dropping it', (_label, sql) => {
    reject(sql);
  });

  it('rejects trailing clauses after the values list', () => {
    reject(
      "insert into public.fsm_state (machine_id, status) values ('a', 'b') on conflict do nothing;",
    );
  });

  it.each([
    ['unqualified insert', "insert into fsm_state (machine_id, status) values ('a', 'b');"],
    ['unqualified delete', "delete from fsm_edge where machine_id = 'a';"],
    ['quoted table', `insert into public."fsm_state" (machine_id, status) values ('a', 'b');`],
    ['quoted schema', `delete from "public"."fsm_edge" where machine_id = 'a';`],
    ['truncate', 'truncate public.fsm_edge;'],
    ['insert select', 'insert into public.fsm_state (machine_id, status) select 1, 2;'],
    ['do block', "do $$ begin insert into public.fsm_state values ('a', 'b'); end $$;"],
  ])('rejects a catalog write the replay cannot read (%s)', (_label, sql) => {
    reject(sql);
  });

  it('rejects a tuple width mismatch', () => {
    reject("insert into public.fsm_state (machine_id, status) values ('admin_task', 'open', 'x');");
    reject(
      "insert into public.fsm_edge (machine_id, from_status, to_status, role) values ('a', 'b', 'c');",
    );
  });

  it('keeps function bodies that mention the catalog out of the replay', () => {
    const body = `create function public.f() returns void language plpgsql as $$
      begin delete from public.fsm_edge where machine_id = 'x'; select 1 from fsm_state; end $$;`;
    expect(replayFsmSql([{ name: '1.sql', sql: body }])).toEqual({ states: [], edges: [] });
  });

  it('keeps named dollar-quoted bodies and commented-out writes out of the replay', () => {
    const sql = `
      -- insert into public.fsm_state (machine_id, status) values ('ghost', 'a');
      /* delete from public.fsm_edge where machine_id = 'ghost'; */
      create function public.g() returns void language plpgsql as $fn$
        begin insert into public.fsm_state (machine_id, status) values ('ghost', 'b'); end $fn$;
      insert into public.fsm_state (machine_id, status) values ('it''s', 'a;b');
    `;
    expect(replayFsmSql([{ name: '1.sql', sql }])).toEqual({
      states: [{ machineId: "it's", status: 'a;b' }],
      edges: [],
    });
  });
});
