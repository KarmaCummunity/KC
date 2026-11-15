-- Report case tools (FR-ADMIN-002, FR-ADMIN-007, FR-ADMIN-012, FR-ADMIN-013): a restore
-- dismisses the case, staff restore chats and comments, the inbox is grouped on the server,
-- the case timeline is whole for every staff role, the member audit lookup matches the actor
-- or the target, and members reach none of it.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local kc.rate_limit_exempt = 'on';

-- Runs a statement as a member (@x = member x, #NN = post NN, %N = comment N, !N = chat N)
-- and returns its one value as text, 'ok' for no value, the P0001 / 42501 message, or the
-- SQLSTATE.
create function pg_temp.ids(p_sql text)
returns text
language sql
immutable
as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(p_sql,
    '@([0-9a-f])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g'),
    '#(\d\d)', '''10000000-0000-4000-8000-0000000000\1''::uuid', 'g'),
    '%(\d)', '''50000000-0000-4000-8000-00000000000\1''::uuid', 'g'),
    '!(\d)', '''70000000-0000-4000-8000-00000000000\1''::uuid', 'g');
$$;

create function pg_temp.as_member(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.ids(p_sql);
  v_value text;
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    if v_sql ~* '^\s*(insert|update|delete)\M' and v_sql !~* '\mreturning\M' then
      execute v_sql;
    else
      execute v_sql into v_value;
    end if;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    -- A void function reads as an empty string.
    return coalesce(nullif(v_value, ''), 'ok');
  exception when others then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return case when sqlstate in ('P0001', '42501') then sqlerrm else sqlstate end;
  end;
end;
$$;

-- One value read as the database owner.
create function pg_temp.val(p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  execute pg_temp.ids(p_sql) into v_value;
  return v_value;
end;
$$;

-- Each listed member reports the target.
create function pg_temp.report(p_who text[], p_type text, p_target text)
returns text
language sql
as $$
  select string_agg(distinct pg_temp.as_member(w, format(
    'insert into public.reports (reporter_id, target_type, target_id, reason) values (@%s, %L, %s, ''Spam'')',
    w, p_type, p_target)), ',')
    from unnest(p_who) w;
$$;

select plan(31);

-- a super admin · b moderator · c support · e post owner · 1–6 members (1 is named Reporter One).
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}',
       jsonb_build_object('full_name', case x when '1' then 'Reporter One' else 'Member ' || x end)
  from unnest(string_to_array('a,b,c,e,1,2,3,4,5,6', ',')) x;
insert into public.admin_role_grants (user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'super_admin'),
  ('00000000-0000-4000-8000-00000000000b', 'moderator'),
  ('00000000-0000-4000-8000-00000000000c', 'support');
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'Items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'Item', 'either');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, title, city_id)
select ('10000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-4000-8000-00000000000e',
       'items', '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'post ' || n, 'c1'
  from generate_series(1, 3) n;
-- Comment 1 on post 01 by member 6 with reply 2 (member 5); reply 3 by member 6 deleted by its author.
insert into public.post_comments (id, post_id, author_id, parent_comment_id, body) values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000006', null, 'a comment'),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005',
   '50000000-0000-4000-8000-000000000001', 'a reply'),
  ('50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000006',
   '50000000-0000-4000-8000-000000000001', 'gone');
select pg_temp.as_member('6', $$select public.delete_post_comment(%3)$$);
-- Chat 1 between members 5 and 6.
insert into public.chats (id, kind, direct_user_a, direct_user_b) values
  ('70000000-0000-4000-8000-000000000001', 'direct', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000006');
insert into public.chat_members (chat_id, user_id) values
  ('70000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005'),
  ('70000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000006');

-- ── A restore closes the case (FR-ADMIN-002 AC4) ────────────────────────────
select is(pg_temp.report('{1,2,3}', 'post', '#01'), 'ok', 'three members report post 01');
select is(pg_temp.val($$select status from public.posts where id = #01$$), 'hidden_pending_review',
  'the post is hidden for review');
select is(pg_temp.as_member('b', $$select public.admin_restore_post(#01)$$), 'ok', 'a moderator restores it');
select is(pg_temp.val($$select status || ' ' || (select string_agg(distinct r.status, ',') from public.reports r
    where r.target_id = #01) from public.posts where id = #01$$), 'open dismissed_no_violation',
  'the post is open and its reports are dismissed');
select is(pg_temp.val($$select count(*) from audit.events where action = 'dismiss_report'$$), '3',
  'each dismissal is audited');
select is(pg_temp.report('{4}', 'user', '@6'), 'ok', 'member 6 is reported once');
select is(pg_temp.as_member('b', $$select public.admin_restore_user(@6)$$)
    || ' ' || pg_temp.val($$select status from public.reports where target_id = @6$$),
  'ok open', 'restoring an active member is a no-op and leaves the case open');

-- ── Restore a chat (FR-ADMIN-002 AC2) ───────────────────────────────────────
select is(pg_temp.report('{1,2,3}', 'chat', '!1'), 'ok', 'three members report chat 1');
select is(pg_temp.as_member('b', $$select public.admin_restore_chat(!1)$$), 'ok',
  'a moderator restores the chat before the queued hide ran');
select is(kc_private.chat_moderation_process() >= 2, true, 'the hide and the restore events are processed in order');
select is(pg_temp.val($$select coalesce(moderation_hidden_at::text, 'visible') from public.chats where id = !1$$)
    || ' ' || pg_temp.val($$select string_agg(distinct status, ',') from public.reports where target_id = !1$$)
    || ' ' || pg_temp.val($$select status from public.moderation_queue where target_id = !1$$),
  'visible dismissed_no_violation resolved', 'the chat stays visible, the reports are dismissed, the review closed');
select is(pg_temp.as_member('5', $$select count(*) from public.messages where chat_id = !1$$), '0',
  'its members read it again');
update public.chats set moderation_hidden_at = now() where id = '70000000-0000-4000-8000-000000000001';
select is(pg_temp.as_member('c', $$select public.admin_restore_chat(!1)$$), 'forbidden', 'support cannot restore a chat');
select is(pg_temp.as_member('b', $$select public.admin_restore_chat(!1)$$)
    || ' ' || pg_temp.as_member('b', $$select public.admin_restore_chat(!1)$$), 'ok ok', 'a restore is idempotent');
select is(pg_temp.val($$select count(*) from audit.events where action = 'restore_target' and target_id = !1$$), '2',
  'one audit row per restore that changed something');
select is(pg_temp.as_member('b', $$select public.admin_restore_chat('70000000-0000-4000-8000-000000000009')$$),
  'target_not_found', 'an unknown chat is refused');

-- ── Remove and restore a comment (FR-ADMIN-013 AC2) ─────────────────────────
select is(pg_temp.report('{1}', 'comment', '%1'), 'ok', 'member 1 reports comment 1');
select is(pg_temp.as_member('b', $$select public.admin_delete_comment(%1)$$)
    || ' ' || pg_temp.val($$select string_agg(status, ',' order by id) from public.post_comments$$)
    || ' ' || pg_temp.val($$select comments_count from public.post_stats where post_id = #01$$),
  'ok deleted,deleted,deleted 0', 'staff remove the comment with its reply');
select is(pg_temp.as_member('b', $$select public.admin_restore_comment(%1)$$)
    || ' ' || pg_temp.val($$select string_agg(status, ',' order by id) from public.post_comments$$)
    || ' ' || pg_temp.val($$select comments_count from public.post_stats where post_id = #01$$),
  'ok active,active,deleted 2', 'a restore brings back what staff removed, not what the author deleted');
select is(pg_temp.val($$select status from public.reports where target_id = %1$$), 'dismissed_no_violation',
  'the comment''s report is dismissed');
select is(pg_temp.as_member('b', $$select public.admin_restore_comment(%3)$$), 'invalid_restore_state',
  'an author''s own deletion cannot be undone by staff');
select is(pg_temp.as_member('6', $$select public.admin_restore_comment(%1)$$), 'forbidden',
  'a member cannot restore a comment');

-- ── Server inbox (FR-ADMIN-012) ─────────────────────────────────────────────
select is(pg_temp.report('{1,2}', 'post', '#02') || pg_temp.report('{5}', 'post', '#03'), 'okok', 'two more cases open');
update public.reports set created_at = now() - interval '40 days' where target_id = '10000000-0000-4000-8000-000000000003';
select is(pg_temp.as_member('c', $$select string_agg(target_type || ':' || reporter_count || '/' || report_count, ',')
    from public.admin_reports_inbox()$$), 'post:1/1,post:2/2,user:1/1',
  'support reads every open case, oldest first (ties by type and id), with its counts');
select is(pg_temp.as_member('c', $$select string_agg(target_id::text, ',') from public.admin_reports_inbox(p_limit => 1,
    p_after_oldest_at => (select min(created_at) from public.reports where target_id = #03),
    p_after_target_type => 'post', p_after_target_id => #03)$$), '10000000-0000-4000-8000-000000000002',
  'the next page starts after the cursor');
select is(pg_temp.as_member('c', $$select string_agg(target_id::text, ',') from public.admin_reports_inbox(p_max_age_days => 30,
    p_target_type => 'post')$$), '10000000-0000-4000-8000-000000000002', 'filters by type and age keep whole cases');
select is(pg_temp.as_member('c', $$select string_agg(target_type || ':' || reporter_count, ',')
    from public.admin_reports_inbox(p_search => 'reporter ONE')$$)
    || ' ' || pg_temp.as_member('c', $$select string_agg(target_type, ',')
    from public.admin_reports_inbox(p_search => '10000000-0000-4000-8000-000000000003')$$),
  'post:2 post', 'search finds a reporter by name (whole case kept) or a target by id');
select is(pg_temp.as_member('5', $$select count(*) from public.admin_reports_inbox()$$), 'forbidden',
  'a member cannot read the inbox');

-- ── Case timeline and audit lookup (FR-ADMIN-013 AC1, FR-ADMIN-007) ─────────
select is(pg_temp.as_member('c', $$select string_agg(action, ',') from public.admin_report_case_timeline('post', #01)$$),
  'report_target,report_target,report_target,post_status_moderated,auto_remove_target,post_status_moderated,'
  || 'restore_target,dismiss_report,dismiss_report,dismiss_report',
  'support reads the whole history of a case, whoever acted');
select is(pg_temp.as_member('c', $$select count(*) from public.admin_report_case_timeline('user', @e)$$), 'case_not_found',
  'a target that was never reported has no timeline');
select is(pg_temp.as_member('a', $$select string_agg(distinct action, ',') from public.admin_audit_lookup(@b)$$)
    || ' ' || pg_temp.as_member('b', $$select count(*) from public.admin_audit_lookup(@b)$$),
  'admin_role_grant,dismiss_report,manual_remove_target,post_status_moderated,restore_target forbidden',
  'the super admin sees what a member did as well as what was done to them; nobody else may look');

select * from finish();
rollback;
