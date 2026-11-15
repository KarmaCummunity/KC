-- Staff timesheets (FR-ADMIN-033, migration 0036): reporting is for platform staff; the
-- reporter's direct manager (or a super admin) decides, nobody decides their own entry; the
-- `timesheet` machine (edit of a rejected entry → draft, approved is final, decide only from
-- submitted, delete only draft or rejected); visibility; keyset order; audit of decisions.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.uid(p_who text)
returns uuid
language sql
as $$ select ('00000000-0000-4000-8000-0000000000' || to_hex(ascii(p_who)))::uuid; $$;

-- Runs `p_sql` as the member: its single value as text, 'ok' for no value, or the P0001
-- message / the SQLSTATE of the error.
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
    v_out := coalesce(nullif(v_out, ''), 'ok');
  exception when others then
    v_out := case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return v_out;
end;
$$;

-- The entry of a member with the given project.
create function pg_temp.entry(p_project text)
returns uuid
language sql
as $$ select e.id from kc_private.timesheet_entries e where e.project = p_project; $$;

create function pg_temp.status(p_project text)
returns text
language sql
as $$ select e.status from kc_private.timesheet_entries e where e.project = p_project; $$;

select plan(37);

-- s super admin; m moderator, the direct manager of p; n moderator who manages nobody;
-- p support who reports to m; q support with no manager; x an ordinary member.
insert into auth.users (id, email, raw_app_meta_data)
select pg_temp.uid(x), 'u' || x || '@example.test', '{"provider":"google"}'
  from unnest(array['s', 'm', 'n', 'p', 'q', 'x']) x;
insert into public.admin_role_grants (user_id, role) values
  (pg_temp.uid('s'), 'super_admin'), (pg_temp.uid('m'), 'moderator'), (pg_temp.uid('n'), 'moderator'), (pg_temp.uid('q'), 'support');
insert into public.admin_role_grants (user_id, role, manager_grant_id)
select pg_temp.uid('p'), 'support', g.id from public.admin_role_grants g where g.user_id = pg_temp.uid('m');

-- ── Reporting ───────────────────────────────────────────────────────────────
select is(pg_temp.run('x', $$select public.timesheet_upsert(null, current_date, 100)$$), '42501', 'an ordinary member cannot report hours');
select is(pg_temp.run('p', $$select public.timesheet_upsert(null, current_date)$$), 'missing_required_fields', 'a new entry needs a date and hours');
select is(pg_temp.run('p', $$select public.timesheet_upsert(null, current_date, 2401)$$), 'invalid_hours', 'hours above 24 are refused');
select is(pg_temp.run('p', format('select public.timesheet_upsert(null, current_date, 100, %L)', repeat('p', 201))), 'invalid_input', 'a project name over 200 characters is refused');
select isnt(pg_temp.run('p', $$select public.timesheet_upsert(null, current_date, 250, 'A', 'work')$$), null, 'support reports a draft');
select isnt(pg_temp.run('p', $$select public.timesheet_upsert(null, current_date - 1, 100, 'B')$$), null, 'a second draft');
select isnt(pg_temp.run('q', $$select public.timesheet_upsert(null, current_date, 300, 'Q')$$), null, 'another staff member reports');
select isnt(pg_temp.run('m', $$select public.timesheet_upsert(null, current_date - 2, 400, 'M')$$), null, 'the manager reports their own hours');
select is(pg_temp.status('A'), 'draft', 'an entry starts as a draft');
select is(pg_temp.run('q', format('select public.timesheet_upsert(%L, p_hours_x100 => 1)', pg_temp.entry('A'))), 'entry_not_found', 'another member''s entry is not found');

-- ── Submitting and deciding ─────────────────────────────────────────────────
select is(pg_temp.run('m', format('select public.timesheet_approve(%L)', pg_temp.entry('A'))), 'invalid_status', 'a draft cannot be decided');
select is(pg_temp.run('p', format('select public.timesheet_submit(%L)', pg_temp.entry('A'))), 'ok', 'the author submits');
select is(pg_temp.run('p', format('select public.timesheet_submit(%L)', pg_temp.entry('A'))), 'invalid_status', 'a submitted entry is not submitted again');
select is(pg_temp.run('p', format('select public.timesheet_upsert(%L, p_hours_x100 => 1)', pg_temp.entry('A'))), 'invalid_status', 'a submitted entry is not edited');
select is(pg_temp.run('n', format('select public.timesheet_approve(%L)', pg_temp.entry('A'))), 'entry_not_found', 'a moderator who is not the manager neither sees nor decides it');
select is(pg_temp.run('q', format('select public.timesheet_approve(%L)', pg_temp.entry('A'))), 'entry_not_found', 'a peer cannot decide it');
select is(pg_temp.run('m', format('select public.timesheet_reject(%L, %L)', pg_temp.entry('A'), 'split by project')), 'ok', 'the direct manager rejects with a note');
select is((select concat_ws('|', status, (approved_by = pg_temp.uid('m'))::text, approval_note) from kc_private.timesheet_entries where project = 'A'),
  'rejected|true|split by project', 'the decision is stamped');
select is((select e.payload -> 'data' from kc_private.outbox_events e where e.topic = 'audit' and e.payload ->> 'action' = 'timesheet_decide'),
  jsonb_build_object('decision', 'rejected', 'entry_owner_id', pg_temp.uid('p')), 'the decision is audited without the note');
select is(pg_temp.run('p', format('select public.timesheet_upsert(%L, p_hours_x100 => 200)', pg_temp.entry('A'))), pg_temp.entry('A')::text, 'the author edits a rejected entry');
select is((select concat_ws('|', status, hours_x100, (approved_at is null)::text) from kc_private.timesheet_entries where project = 'A'), 'draft|200|true',
  'editing a rejected entry sends it back to draft');
select is(pg_temp.run('p', format('select public.timesheet_submit(%L)', pg_temp.entry('A'))), 'ok', 'the author submits again');
select is(pg_temp.run('m', format('select public.timesheet_approve(%L)', pg_temp.entry('A'))), 'ok', 'the direct manager approves');
select is(pg_temp.run('m', format('select public.timesheet_reject(%L)', pg_temp.entry('A'))), 'invalid_status', 'approved is final');
select is(pg_temp.run('p', format('select public.timesheet_delete(%L)', pg_temp.entry('A'))), 'invalid_status', 'an approved entry is not deleted');

-- Nobody decides their own entry, a super admin included.
select is(pg_temp.run('m', format('select public.timesheet_submit(%L)', pg_temp.entry('M'))), 'ok', 'the manager submits their own entry');
select is(pg_temp.run('m', format('select public.timesheet_approve(%L)', pg_temp.entry('M'))), '42501', 'the manager cannot approve their own entry');
select isnt(pg_temp.run('s', $$select public.timesheet_upsert(null, current_date, 100, 'S')$$), null, 'the super admin reports');
select is(pg_temp.run('s', format('select public.timesheet_submit(%L)', pg_temp.entry('S'))) || '|' ||
          pg_temp.run('s', format('select public.timesheet_approve(%L)', pg_temp.entry('S'))), 'ok|42501', 'a super admin cannot approve their own entry');
select is(pg_temp.run('s', format('select public.timesheet_approve(%L)', pg_temp.entry('M'))), 'ok', 'a super admin approves anyone else''s entry');

-- ── Lists ───────────────────────────────────────────────────────────────────
select is(pg_temp.run('p', format('select public.timesheet_submit(%L)', pg_temp.entry('B'))), 'ok', 'p submits a second entry');
select is(pg_temp.run('m', $$select string_agg(l.entry ->> 'project', ',' order by n) from public.timesheet_list('to_decide') with ordinality l(entry, cursor, n)$$),
  'B', 'the manager''s queue holds the submitted entries of their reports');
select is(pg_temp.run('m', $$select string_agg((l.entry ->> 'project') || ':' || (l.entry ->> 'can_decide'), ',' order by n) from public.timesheet_list('all') with ordinality l(entry, cursor, n)$$),
  'A:false,B:true,M:false', 'the manager sees their own and their reports'' entries, newest work date first');
select is(pg_temp.run('n', $$select count(*) from public.timesheet_list('all')$$), '0', 'a moderator who manages nobody sees nothing else');
select is(pg_temp.run('s', $$
  with p1 as (select * from public.timesheet_list('all', p_limit => 3) with ordinality l(entry, cursor, n))
  select (select count(*) from p1) || '/' || string_agg(project, ',' order by project)
    from (select entry ->> 'project' as project from p1
          union all
          select l.entry ->> 'project' from public.timesheet_list('all', p_limit => 3, p_cursor => (select cursor from p1 order by n desc limit 1)) l) pages$$),
  '3/A,B,M,Q,S', 'the cursor pages through every entry once');
select is(pg_temp.run('s', $$select public.timesheet_count('all')$$) || '|' || pg_temp.run('p', $$select public.timesheet_count('mine')$$), '5|2', 'the counts follow visibility');

-- ── Deleting ────────────────────────────────────────────────────────────────
select is(pg_temp.run('q', format('select public.timesheet_delete(%L)', pg_temp.entry('Q'))) || '|' || pg_temp.run('q', $$select public.timesheet_count('mine')$$),
  'ok|0', 'the author deletes a draft and it is hidden');

select * from finish();
rollback;
