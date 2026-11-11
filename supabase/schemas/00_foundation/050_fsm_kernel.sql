-- Foundation · lifecycle state machines (engineering decision D-226)
--
-- Every status column in the database moves only along edges declared here. The same edge list
-- is mirrored by FSM_MACHINES in @kc/domain, so SQL, TypeScript and tests share one graph.
-- Each module inserts its own machines next to the table that uses them.

-- The closed set of states of each machine.
create table kc_private.fsm_state (
  machine_id text not null,
  status     text not null,
  primary key (machine_id, status)
);
comment on table kc_private.fsm_state is 'State set of each lifecycle machine. Written only by migrations.';

-- Legal moves. `role = ''` admits every caller; any other value admits only that role.
create table kc_private.fsm_edge (
  machine_id  text not null,
  from_status text not null,
  to_status   text not null,
  role        text not null default '',
  primary key (machine_id, from_status, to_status, role),
  foreign key (machine_id, from_status) references kc_private.fsm_state (machine_id, status),
  foreign key (machine_id, to_status) references kc_private.fsm_state (machine_id, status)
);
comment on table kc_private.fsm_edge is 'Legal moves of each lifecycle machine. Written only by migrations.';
create index fsm_edge_to_status_idx on kc_private.fsm_edge (machine_id, to_status);

alter table kc_private.fsm_state enable row level security;
alter table kc_private.fsm_state force row level security;
alter table kc_private.fsm_edge enable row level security;
alter table kc_private.fsm_edge force row level security;

-- Raises unless `p_from → p_to` is a legal move of `p_machine` for `p_role`.
--   unknown_state        a status that the machine does not have
--   illegal_transition   no edge between the two states
--   forbidden_role       the edge exists, but not for this caller
-- Writing the same status again is a legal no-op.
create function kc_private.fsm_assert_transition(
  p_machine text,
  p_from text,
  p_to text,
  p_role text default null
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_edge_roles text[];
begin
  if (select count(*) from kc_private.fsm_state s
       where s.machine_id = p_machine and s.status in (p_from, p_to))
     <> (case when p_from = p_to then 1 else 2 end) then
    raise exception 'unknown_state' using errcode = 'P0001', detail = format('%s: %s → %s', p_machine, p_from, p_to);
  end if;

  if p_from = p_to then
    return;
  end if;

  select array_agg(e.role) into v_edge_roles
    from kc_private.fsm_edge e
   where e.machine_id = p_machine and e.from_status = p_from and e.to_status = p_to;

  if v_edge_roles is null then
    raise exception 'illegal_transition' using errcode = 'P0001', detail = format('%s: %s → %s', p_machine, p_from, p_to);
  end if;

  -- An unrestricted edge admits anyone; a restricted one fails closed on a missing role.
  if '' = any (v_edge_roles) or p_role = any (v_edge_roles) then
    return;
  end if;

  raise exception 'forbidden_role' using errcode = 'P0001', detail = format('%s: %s → %s', p_machine, p_from, p_to);
end;
$$;
comment on function kc_private.fsm_assert_transition(text, text, text, text) is
  'Raises unless the move is a legal edge of the machine for the given role.';

-- Generic guard for a status column. Attach as:
--   before insert or update of <column> on <table>
--   for each row execute function kc_private.fsm_guard_status('<machine>', '<column>')
-- On insert the status must belong to the machine; on update the move must be a legal edge.
-- The acting role is read from the transaction-local setting `kc.fsm_role`, which the RPC
-- performing a role-restricted move sets before it writes.
-- Definer rights: a table a member inserts into directly (a post) runs this trigger as that
-- member, who can neither resolve names in this schema nor read the kernel tables.
create function kc_private.fsm_guard_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_machine constant text := tg_argv[0];
  v_column constant text := tg_argv[1];
  v_new text := to_jsonb(new) ->> v_column;
  v_old text;
begin
  if tg_op = 'INSERT' then
    -- A move from a state to itself only checks that the state exists.
    perform kc_private.fsm_assert_transition(v_machine, v_new, v_new);
    return new;
  end if;

  v_old := to_jsonb(old) ->> v_column;
  perform kc_private.fsm_assert_transition(
    v_machine, v_old, v_new, nullif(current_setting('kc.fsm_role', true), ''));
  return new;
end;
$$;
comment on function kc_private.fsm_guard_status() is
  'BEFORE INSERT OR UPDATE trigger: enforces the machine named in its first argument on the column named in its second.';
