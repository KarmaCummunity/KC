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

\echo '✓ 0676_fsm_catalog.sql passed'
