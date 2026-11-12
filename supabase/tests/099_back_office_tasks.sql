-- Admin tasks (FR-ADMIN-018, migration 0034): role gates, the creator-or-assignee rule, the
-- `admin_task` machine and its error mapping, one activity per changed field, the
-- `task_assigned` notification (never to the actor), audit events on topic `audit`, keyset
-- order, hard delete with its history, and the creator's account purge keeping the task.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Members: s super admin, m moderator, p and q support, r support who is neither creator nor
-- assignee, x an ordinary member.
create function pg_temp.uid(p_who text)
returns uuid
language sql
as $$ select ('00000000-0000-4000-8000-0000000000' || to_hex(ascii(p_who)))::uuid; $$;

-- Runs `p_sql` as the member and returns its single value as text, or the P0001 message /
-- the SQLSTATE of the error it raised.
create function pg_temp.run(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid(p_who), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql into v_out;
    -- A void function returns an empty value.
    v_out := coalesce(nullif(v_out, ''), 'ok');
  exception when others then
    v_out := case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return v_out;
end;
$$;

create function pg_temp.task(p_title text)
returns uuid
language sql
as $$ select t.id from kc_private.admin_tasks t where t.title = p_title; $$;

create function pg_temp.activities(p_title text, p_kind text)
returns bigint
language sql
as $$ select count(*) from kc_private.admin_task_activities a where a.task_id = pg_temp.task(p_title) and a.kind = p_kind; $$;

create function pg_temp.notices(p_who text)
returns bigint
language sql
as $$
  select count(*) from kc_private.outbox_events e
   where e.topic = 'notification' and e.payload ->> 'kind' = 'task_assigned'
     and e.payload ->> 'recipient_id' = pg_temp.uid(p_who)::text;
$$;

create function pg_temp.audits(p_action text)
returns bigint
language sql
as $$ select count(*) from kc_private.outbox_events e where e.topic = 'audit' and e.payload ->> 'action' = p_action; $$;

select plan(58);

insert into auth.users (id, email, raw_app_meta_data)
select pg_temp.uid(x), 'u' || x || '@example.test', '{"provider":"google"}'
  from unnest(array['s', 'm', 'p', 'q', 'r', 'x']) x;
insert into public.admin_role_grants (user_id, role) values
  (pg_temp.uid('s'), 'super_admin'), (pg_temp.uid('m'), 'moderator'),
  (pg_temp.uid('p'), 'support'), (pg_temp.uid('q'), 'support'), (pg_temp.uid('r'), 'support');

-- ── Creating ────────────────────────────────────────────────────────────────
select is(pg_temp.run('x', $$select public.admin_task_create('T1')$$), '42501', 'an ordinary member cannot create a task');
select is(pg_temp.run('p', $$select public.admin_task_create('  ')$$), 'invalid_title', 'a blank title is refused');
select is(pg_temp.run('p', format('select public.admin_task_create(%L)', repeat('a', 201))), 'title_too_long', 'a title over 200 characters is refused');
select is(pg_temp.run('p', $$select public.admin_task_create('T1', p_priority => 'asap')$$), 'invalid_priority', 'an unknown priority is refused');
select is(pg_temp.run('p', $$select public.admin_task_create('T1', p_category => 'misc')$$), 'invalid_category', 'an unknown category is refused');
select is(pg_temp.run('p', format('select public.admin_task_create(%L, %L)', 'T1', repeat('d', 4001))), 'invalid_input', 'a description over 4000 characters is refused');
select is(pg_temp.run('p', format('select public.admin_task_create(%L, p_assignee_id => %L)', 'T1', pg_temp.uid('x'))),
  'assignee_not_admin', 'the assignee must be platform staff');
select isnt(pg_temp.run('p', format($$select public.admin_task_create('T1', 'first', 'high', %L, now() - interval '1 day', array['ops'], 'support')$$, pg_temp.uid('q'))),
  null, 'support creates a task assigned to another staff member');
select is((select status || '|' || priority || '|' || category || '|' || (created_by = pg_temp.uid('p'))::text
             from kc_private.admin_tasks where title = 'T1'), 'open|high|support|true', 'the task starts open with the given fields');
select is(pg_temp.activities('T1', 'created'), 1::bigint, 'creation writes a created activity');
select is(pg_temp.notices('q'), 1::bigint, 'the assignee is notified');
select is((select e.payload #>> '{data,task_title}' || '|' || (e.payload #>> '{data,dedupe_key}')
             from kc_private.outbox_events e where e.topic = 'notification' and e.payload ->> 'kind' = 'task_assigned'),
  'T1|task_assigned:' || pg_temp.task('T1') || ':' || pg_temp.uid('q'), 'the notice carries the task title and a dedupe key');
select is((select e.payload -> 'data' from kc_private.outbox_events e where e.topic = 'audit' and e.payload ->> 'action' = 'admin_task_create'),
  jsonb_build_object('assignee_id', pg_temp.uid('q'), 'category', 'support', 'priority', 'high'), 'the creation is audited with ids and codes only');
select isnt(pg_temp.run('p', format('select public.admin_task_create(%L, p_assignee_id => %L)', 'T2', pg_temp.uid('p'))), null,
  'a task assigned to its creator is created');
select is(pg_temp.notices('p'), 0::bigint, 'nobody is notified of their own assignment');

-- ── Assigning ───────────────────────────────────────────────────────────────
select is(pg_temp.run('p', format('select public.admin_task_assign(%L, %L)', pg_temp.task('T2'), pg_temp.uid('q'))), '42501', 'support cannot assign');
select is(pg_temp.run('m', format('select public.admin_task_assign(%L, %L)', pg_temp.task('T2'), pg_temp.uid('x'))), 'assignee_not_admin', 'a moderator cannot assign a non-staff member');
select is(pg_temp.run('m', format('select public.admin_task_assign(%L, %L)', pg_temp.task('T2'), pg_temp.uid('q'))), 'ok', 'a moderator assigns');
select is(pg_temp.notices('q') || '|' || pg_temp.activities('T2', 'assignment_change') || '|' || pg_temp.audits('admin_task_assign'),
  '2|1|1', 'the new assignee is notified, and the change is logged and audited');
select is(pg_temp.run('m', format('select public.admin_task_assign(%L, %L)', pg_temp.task('T2'), pg_temp.uid('q'))) || '|' || pg_temp.activities('T2', 'assignment_change'),
  'ok|1', 'assigning the same member again changes nothing');
select is(pg_temp.run('m', format('select public.admin_task_assign(%L, null)', pg_temp.task('T2'))), 'ok', 'a moderator unassigns');
select is((select coalesce(assignee_id::text, 'none') from kc_private.admin_tasks where title = 'T2'), 'none', 'the task has no assignee');

-- ── Editing ─────────────────────────────────────────────────────────────────
select is(pg_temp.run('r', format('select public.admin_task_update(%L, %L)', pg_temp.task('T1'), 'X')), '42501',
  'staff who neither created nor hold the task cannot edit it');
select is(pg_temp.run('q', format($$select public.admin_task_update(%L, p_title => 'T1b', p_priority => 'low', p_category => 'support')$$, pg_temp.task('T1'))),
  'ok', 'the assignee edits the task');
select is(pg_temp.activities('T1b', 'title_change') || '|' || pg_temp.activities('T1b', 'priority_change') || '|' || pg_temp.activities('T1b', 'category_change'),
  '1|1|0', 'one activity per changed field, none for an unchanged one');
select is((select e.payload #> '{data,fields}' from kc_private.outbox_events e where e.topic = 'audit' and e.payload ->> 'action' = 'admin_task_update'),
  '["title", "priority"]'::jsonb, 'the edit is audited with the names of the changed fields');
select is(pg_temp.run('s', format('select public.admin_task_update(%L, p_clear_due => true, p_description => %L)', pg_temp.task('T1b'), '')),
  'ok', 'a super admin edits any task');
select is((select (due_at is null and description is null)::text from kc_private.admin_tasks where title = 'T1b'), 'true',
  'clearing the due date and the description works');
select is(pg_temp.run('q', format('select public.admin_task_update(%L, p_labels => array[%L])', pg_temp.task('T1b'), 'ops')) || '|' || pg_temp.audits('admin_task_update'),
  'ok|2', 'a patch that changes nothing writes nothing');
select is(pg_temp.run('p', format('select public.admin_task_update(%L)', gen_random_uuid())), 'task_not_found', 'an unknown task is not found');

-- ── Status machine ──────────────────────────────────────────────────────────
select is(pg_temp.run('q', format($$select public.admin_task_set_status(%L, 'done')$$, pg_temp.task('T1b'))), 'invalid_transition', 'open cannot jump to done');
select is(pg_temp.run('q', format($$select public.admin_task_set_status(%L, 'closed')$$, pg_temp.task('T1b'))), 'invalid_status', 'an unknown status is refused');
select is(pg_temp.run('r', format($$select public.admin_task_set_status(%L, 'in_progress')$$, pg_temp.task('T1b'))), '42501', 'an outsider cannot move the task');
select is(pg_temp.run('q', format($$select public.admin_task_set_status(%L, 'in_progress')$$, pg_temp.task('T1b'))) || '|' ||
          pg_temp.run('q', format($$select public.admin_task_set_status(%L, 'blocked')$$, pg_temp.task('T1b'))) || '|' ||
          pg_temp.run('p', format($$select public.admin_task_set_status(%L, 'done')$$, pg_temp.task('T1b'))) || '|' ||
          pg_temp.run('p', format($$select public.admin_task_set_status(%L, 'archived')$$, pg_temp.task('T1b'))),
  'ok|ok|ok|ok', 'open → in progress → blocked → done → archived');
select is(pg_temp.activities('T1b', 'status_change') || '|' || pg_temp.audits('admin_task_status'), '4|4', 'each move is logged and audited');
select is(pg_temp.run('p', format($$select public.admin_task_set_status(%L, 'archived')$$, pg_temp.task('T1b'))) || '|' || pg_temp.activities('T1b', 'status_change'),
  'ok|4', 'the same status again is a no-op');
select is(pg_temp.run('p', format($$select public.admin_task_set_status(%L, 'open')$$, pg_temp.task('T1b'))), 'invalid_transition', 'archived is terminal');
select throws_ok(format($$update kc_private.admin_tasks set status = 'archived' where id = %L$$, pg_temp.task('T2')),
  'P0001', 'illegal_transition', 'the guard trigger refuses a move that skips the RPC');

-- ── Comments ────────────────────────────────────────────────────────────────
select is(pg_temp.run('r', format($$select public.admin_task_add_comment(%L, '   ')$$, pg_temp.task('T2'))), 'empty_comment', 'an empty comment is refused');
select is(pg_temp.run('r', format('select public.admin_task_add_comment(%L, %L)', pg_temp.task('T2'), repeat('c', 4001))), 'comment_too_long', 'a comment over 4000 characters is refused');
select isnt(pg_temp.run('r', format($$select public.admin_task_add_comment(%L, 'looking')$$, pg_temp.task('T2'))), null, 'any staff member comments');
select is(pg_temp.run('p', format('select (public.admin_task_detail(%L) ->> %L)', pg_temp.task('T2'), 'comment_count')), '1', 'the detail counts the comment');
select is(pg_temp.run('p', format($$select jsonb_path_query_array(public.admin_task_detail(%L), '$.activities[*].kind')::text$$, pg_temp.task('T2'))),
  '["created", "assignment_change", "assignment_change", "comment"]', 'the detail lists the history oldest first');
select is(pg_temp.run('p', format('select public.admin_task_detail(%L)::text', gen_random_uuid())), 'ok', 'the detail of an unknown task is null');
select throws_ok($$update kc_private.admin_task_activities set payload = '{}'$$, 'P0001', 'append_only', 'the history is never rewritten');

-- ── List ────────────────────────────────────────────────────────────────────
-- T3 due tomorrow, T4 due in a week, T5 no due date; T2 open with no due date; T1b archived.
select lives_ok($$select pg_temp.run('m', $q$select public.admin_task_create('T3', p_due_at => now() + interval '1 day')$q$),
                         pg_temp.run('m', $q$select public.admin_task_create('T4', p_due_at => now() + interval '7 days')$q$),
                         pg_temp.run('m', $q$select public.admin_task_create('T5')$q$)$$, 'more tasks are created');
-- Creation times inside one test transaction are equal; spread them so "newest first" is visible.
update kc_private.admin_tasks set created_at = now() + interval '1 minute' where title = 'T5';
select is(pg_temp.run('p', $$select string_agg(l.task ->> 'title', ',' order by n) from public.admin_task_list() with ordinality l(task, cursor, n)$$),
  'T3,T4,T5,T2,T1b', 'open tasks by due date with no date last and newest first, archived last');
select is(pg_temp.run('p', $$
  with p1 as (select * from public.admin_task_list(p_limit => 2) with ordinality l(task, cursor, n)),
       p2 as (select * from public.admin_task_list(p_limit => 2, p_cursor => (select cursor from p1 order by n desc limit 1)) with ordinality l(task, cursor, n)),
       p3 as (select * from public.admin_task_list(p_limit => 2, p_cursor => (select cursor from p2 order by n desc limit 1)) with ordinality l(task, cursor, n))
  select (select string_agg(task ->> 'title', ',' order by n) from p1) || '/' || (select string_agg(task ->> 'title', ',' order by n) from p2)
         || '/' || (select string_agg(task ->> 'title', ',' order by n) from p3)$$),
  'T3,T4/T5,T2/T1b', 'the cursor pages through the same order without gaps or repeats');
select is(pg_temp.run('q', $$select string_agg(l.task ->> 'title', ',') from public.admin_task_list(p_only_mine => true) l$$), 'T1b',
  'only mine: the tasks assigned to or created by the caller');
select is(pg_temp.run('p', $$select string_agg(l.task ->> 'title', ',' order by l.task ->> 'title') from public.admin_task_list(p_unassigned_only => true, p_status => 'open') l$$),
  'T2,T3,T4,T5', 'the unassigned filter');
update kc_private.admin_tasks set due_at = now() - interval '1 hour' where title = 'T3';
select is(pg_temp.run('p', $$select string_agg(l.task ->> 'title', ',') from public.admin_task_list(p_overdue => true) l$$), 'T3', 'overdue: past due and not done or archived');
select is(pg_temp.run('p', 'select public.admin_task_open_count()'), '4', 'the dashboard counts open and in-progress tasks');
select is(pg_temp.run('x', 'select count(*) from public.admin_task_list()'), '42501', 'an ordinary member cannot list tasks');
select is(pg_temp.run('p', 'select count(*) from kc_private.admin_tasks'), '42501', 'the table is not readable directly');

-- ── Delete and purge ────────────────────────────────────────────────────────
select is(pg_temp.run('q', format('select public.admin_task_delete(%L)', pg_temp.task('T2'))), '42501', 'only the creator or a super admin deletes');
select is(pg_temp.run('p', format('select public.admin_task_delete(%L)', pg_temp.task('T2'))), 'ok', 'the creator deletes the task');
select is((select count(*) from kc_private.admin_task_activities a where a.payload ->> 'body' = 'looking') || '|' || pg_temp.audits('admin_task_delete'),
  '0|1', 'its history goes with it, and the delete is audited');
delete from auth.users where id = pg_temp.uid('m');
select is((select (created_by is null)::text || '|' || (select count(*) from kc_private.admin_task_activities a where a.task_id = t.id and a.actor_id is null)
             from kc_private.admin_tasks t where t.title = 'T5'), 'true|1', 'purging the creator keeps the task and its history');

select * from finish();
rollback;
