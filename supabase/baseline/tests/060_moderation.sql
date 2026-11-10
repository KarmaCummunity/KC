-- Moderation: staff roles follow rank and position; staff read more and members read no
-- more than before; a report hides its target from the reporter, acts at the configured
-- thresholds and is resolved by staff only; sanctions, removals and restores move along the
-- account and post machines; every privileged action leaves an audit row.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Test shorthand inside SQL text: @x is the member with hex digit x, #NN a post, ~x/role
-- the active grant of that role held by member x.
create function pg_temp.expand(p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql text := p_sql;
  v_match text[];
begin
  for v_match in select regexp_matches(p_sql, '~([0-9a-f])/([a-z_]+)', 'g') loop
    v_sql := replace(v_sql, '~' || v_match[1] || '/' || v_match[2], coalesce(quote_literal((
      select g.id from public.admin_role_grants g
       where g.user_id = ('00000000-0000-4000-8000-00000000000' || v_match[1])::uuid
         and g.role = v_match[2] and g.revoked_at is null)), 'null') || '::uuid');
  end loop;
  v_sql := regexp_replace(v_sql, '@([0-9a-f])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
  return regexp_replace(v_sql, '#(\d\d)', '''10000000-0000-4000-8000-0000000000\1''::uuid', 'g');
end;
$$;

-- Runs a statement as a signed-in member. Returns 'ok', the message of a P0001 error, or
-- the SQLSTATE of any other error.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    execute v_sql;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return 'ok';
  exception when others then
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- Rows a member can read with the given query.
create function pg_temp.seen(p_who text, p_sql text)
returns bigint
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
  v_rows bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute 'select count(*) from (' || v_sql || ') q' into v_rows;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return v_rows;
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
  execute pg_temp.expand(p_sql) into v_value;
  return v_value;
end;
$$;

-- Each of the listed members reports the target; returns the distinct outcomes.
create function pg_temp.report(p_who text[], p_type text, p_target text)
returns text
language sql
as $$
  select string_agg(distinct pg_temp.act(w, format(
    'insert into public.reports (reporter_id, target_type, target_id, reason) values (@%s, %L, %s, ''Spam'')',
    w, p_type, p_target)), ',')
    from unnest(p_who) w;
$$;

-- Staff member p_who resolves the open report of member p_reporter on a target.
create function pg_temp.resolve(p_who text, p_rpc text, p_reporter text, p_target text)
returns text
language sql
as $$
  select pg_temp.act(p_who, format('select public.%I(%L)', p_rpc, pg_temp.val(format(
    'select id from public.reports where reporter_id = @%s and target_id = %s and status = ''open''',
    p_reporter, p_target))));
$$;

-- Queued notification events of a kind.
create function pg_temp.events(p_kind text)
returns bigint
language sql
as $$
  select count(*) from kc_private.outbox_events e where e.topic = 'notification' and e.payload ->> 'kind' = p_kind;
$$;

select plan(94);

-- a super admin · b moderator · c support · d admin · e post owner · f org admin ·
-- 1–8 members · 9 not verified yet.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test',
       case x when '9' then '{"provider":"email"}' else '{"provider":"google"}' end::jsonb
  from unnest(string_to_array('a,b,c,d,e,f,1,2,3,4,5,6,7,8,9', ',')) x;

insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'Items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'Item', 'either');
-- Posts 01–14 of member e; 08 is a draft, 09 is for followers only, the rest open and public.
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title, city_id)
select ('10000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-4000-8000-00000000000e',
       'items', '20000000-0000-4000-8000-000000000001', 'offer', case n when 8 then 'draft' else 'open' end,
       case n when 9 then 'FollowersOnly' else 'Public' end, 'post ' || n, 'c1'
  from generate_series(1, 14) n;
insert into public.post_media (post_id, owner_id, storage_key, ordinal, mime_type, size_bytes, processing_status)
values ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000e',
        '00000000-0000-4000-8000-00000000000e/3.jpg', 0, 'image/jpeg', 1000, 'ready');
insert into public.post_comments (id, post_id, author_id, body) values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000007', 'a comment');

-- Organizations the organization-scoped grants refer to.
insert into public.organizations (id, slug, name) values
  ('60000000-0000-4000-8000-000000000001', 'org-one', 'Org One'), ('60000000-0000-4000-8000-000000000002', 'org-two', 'Org Two');

-- ── Staff roles ─────────────────────────────────────────────────────────────
insert into public.admin_role_grants (user_id, role) values ('00000000-0000-4000-8000-00000000000a', 'super_admin');
select throws_ok($$insert into public.admin_role_grants (user_id, role) values ('00000000-0000-4000-8000-00000000000b', 'super_admin')$$,
  '23505', null, 'there is at most one active super admin');
select throws_ok($$insert into public.admin_role_grants (user_id, role, scope_org_id)
    values ('00000000-0000-4000-8000-00000000000b', 'moderator', gen_random_uuid())$$,
  '23503', null, 'a platform role cannot carry an organization scope');
select is(pg_temp.act('a', $$select public.admin_grant_role(@b, 'moderator')$$)
  || pg_temp.act('a', $$select public.admin_grant_role(@c, 'support')$$)
  || pg_temp.act('a', $$select public.admin_grant_role(@d, 'admin')$$), 'okokok', 'the super admin grants platform roles');
select is(pg_temp.val('select manager_grant_id = ~a/super_admin from public.admin_role_grants where id = ~b/moderator'),
  'true', 'a new grant reports to the grant that allowed it');
select is(pg_temp.act('b', $$select public.admin_grant_role(@1, 'support')$$), '42501', 'a moderator grants nothing, not even a junior role');
select is(pg_temp.act('d', $$select public.admin_grant_role(@1, 'admin')$$), '42501', 'a role is not granted at the granter''s own rank');
select is(pg_temp.act('d', $$select public.admin_grant_role(@1, 'super_admin')$$)
  || pg_temp.act('a', $$select public.admin_grant_role(@1, 'super_admin')$$), '4250142501', 'nobody grants super admin');
select is(pg_temp.act('1', $$select public.admin_grant_role(@2, 'support')$$), '42501', 'a member grants nothing');
select is(pg_temp.act('d', $$select public.admin_grant_role(@1, 'moderator')$$), 'ok', 'an admin grants a junior platform role');
select is(pg_temp.act('a', $$select public.admin_grant_role(@2, 'nobody')$$) || '|'
  || pg_temp.act('a', $$select public.admin_grant_role(@2, 'org_admin')$$) || '|'
  || pg_temp.act('a', $$select public.admin_grant_role(@2, 'moderator', gen_random_uuid())$$) || '|'
  || pg_temp.act('a', $$select public.admin_grant_role(@b, 'moderator')$$) || '|'
  || pg_temp.act('a', $$select public.admin_grant_role(@9, 'support')$$),
  'invalid_role|invalid_scope|invalid_scope|role_already_active|target_not_active', 'a grant is validated');
select is(pg_temp.act('a', $$select public.admin_grant_role(@f, 'org_admin', '60000000-0000-4000-8000-000000000001')$$)
  || pg_temp.act('f', $$select public.admin_grant_role(@2, 'org_manager', '60000000-0000-4000-8000-000000000001')$$),
  'okok', 'an organization admin grants a junior role inside their organization');
select is(pg_temp.act('f', $$select public.admin_grant_role(@3, 'org_manager', '60000000-0000-4000-8000-000000000002')$$)
  || pg_temp.act('f', $$select public.admin_grant_role(@3, 'support')$$), '4250142501',
  'an organization role grants nothing in another organization or on the platform');
select is(pg_temp.act('d', 'select public.admin_revoke_role(~b/moderator)'), '42501', 'a grant outside the caller''s tree is not revoked');
select is(pg_temp.act('b', 'select public.admin_revoke_role(~c/support)'), '42501', 'a moderator revokes nothing');
select is(pg_temp.act('d', 'select public.admin_revoke_role(~1/moderator)'), 'ok', 'a manager revokes a grant below their own');
select is(pg_temp.act('a', 'select public.admin_revoke_role(~f/org_admin)')
  || pg_temp.val('select manager_grant_id = ~a/super_admin from public.admin_role_grants where id = ~2/org_manager'),
  'oktrue', 'the reports of a revoked grant move up to its manager');
select is(pg_temp.act('a', $$select public.admin_change_role(~c/support, 'moderator')$$)
  || pg_temp.val($$select count(*) filter (where revoked_at is null) || '/' || count(*)
       from public.admin_role_grants where user_id = @c$$), 'ok1/2', 'a role change replaces the grant and keeps the history');
select is(pg_temp.act('a', 'select public.admin_set_manager(~c/moderator, ~d/admin)')
  || pg_temp.act('a', 'select public.admin_set_manager(~c/moderator, ~b/moderator)')
  || pg_temp.act('a', 'select public.admin_set_manager(~d/admin, ~c/moderator)'),
  'okinvalid_managerinvalid_manager', 'a grant moves only under a more senior grant');
select is(pg_temp.act('a', $$select public.admin_change_role(~c/moderator, 'support')$$), 'ok', 'the support member is support again');
select is(pg_temp.act('b', $$insert into public.admin_role_grants (user_id, role) values (@b, 'admin')$$)
  || pg_temp.act('b', 'update public.admin_role_grants set revoked_at = now()'), '4250142501', 'grants are not writable from a device');
select is(pg_temp.seen('b', $$select 1 where public.bootstrap_session() -> 'admin' -> 'roles' = '["moderator"]'$$)
  + pg_temp.seen('2', $$select 1 where public.bootstrap_session() -> 'admin' -> 'roles' = '["org_manager"]'$$)
  + pg_temp.seen('3', $$select 1 where public.bootstrap_session() -> 'admin' -> 'roles' = '[]'$$),
  3::bigint, 'session start carries the caller''s staff roles');
select is(pg_temp.seen('2', 'select 1 from public.admin_role_grants') || '/' || pg_temp.seen('3', 'select 1 from public.admin_role_grants')
  || '/' || (pg_temp.seen('c', 'select 1 from public.admin_role_grants') = pg_temp.val('select count(*) from public.admin_role_grants')::bigint),
  '1/0/true', 'a member reads their own grants, staff read the roster');

-- ── Staff read access, and what stays closed ────────────────────────────────
select is(pg_temp.seen('2', 'select 1 from public.users'), 14::bigint, 'a member still sees active profiles only');
select is(pg_temp.seen('c', 'select 1 from public.users') || '/' || pg_temp.seen('c', 'select 1 from public.user_account'),
  '15/15', 'staff read every profile and account state');
select is(pg_temp.seen('2', 'select 1 from public.user_account') || '/' || pg_temp.seen('c', 'select 1 from public.user_private'),
  '1/1', 'a member reads one account row, and staff read no private details of others');
select is(pg_temp.seen('2', 'select 1 from public.posts') || '/' || pg_temp.seen('c', 'select 1 from public.posts'),
  '12/14', 'a member sees public open posts, staff see drafts and follower-only posts too');
select is(pg_temp.seen('2', 'select 1 from public.reports') || '/' || pg_temp.seen('2', 'select 1 from public.user_sanctions')
  || '/' || pg_temp.seen('2', 'select 1 from public.moderation_queue'), '0/0/0', 'a member reads no moderation data');
select is(pg_temp.act('a', $$update public.posts set title = 'edited' where id = #14$$)
  || pg_temp.val('select title from public.posts where id = #14'), 'okedited', 'the super admin edits any post');
select is(pg_temp.act('b', $$update public.posts set title = 'x' where id = #14$$)
  || pg_temp.val('select title from public.posts where id = #14'), 'okedited', 'a moderator cannot edit a post');
select is(pg_temp.act('b', 'select public.pause_post(#14)') || '|' || pg_temp.act('a', 'select public.pause_post(#14)')
  || '|' || pg_temp.act('a', 'select public.resume_post(#14)'), 'post_not_found|ok|ok', 'the super admin manages any post');

-- ── Reports: filing, the reporter's hide ────────────────────────────────────
select is(pg_temp.report('{1}', 'post', '#01'), 'ok', 'a member reports a post');
select is(pg_temp.seen('1', 'select 1 from public.posts where id = #01') || '/' || pg_temp.seen('2', 'select 1 from public.posts where id = #01'),
  '0/1', 'the post disappears for its reporter only');
select is(pg_temp.seen('b', 'select 1 from public.reports') || '/' || pg_temp.seen('1', 'select 1 from public.reports')
  || '/' || pg_temp.seen('2', 'select 1 from public.reports'), '1/1/0', 'the reporter and staff read the report');
select is(pg_temp.report('{1}', 'post', '#01'), '23505', 'one open report per reporter and target');
select is(pg_temp.report('{e}', 'post', '#01') || '|' || pg_temp.report('{1}', 'user', '@1') || '|'
  || pg_temp.report('{1}', 'post', 'gen_random_uuid()') || '|' || pg_temp.report('{9}', 'post', '#02') || '|'
  || pg_temp.report('{1}', 'post', '#08'),
  'cannot_report_self|cannot_report_self|report_target_not_found|42501|target_already_moderated', 'a report is validated');
select is(pg_temp.act('1', $$insert into public.reports (reporter_id, target_type, target_id, reason, status)
    values (@1, 'post', #02, 'Spam', 'confirmed_violation')$$)
  || pg_temp.act('1', $$update public.reports set status = 'dismissed_no_violation'$$), '4250142501', 'a device never writes a report status');
select is(pg_temp.act('1', 'delete from public.report_hides where target_id = #01')
  || pg_temp.seen('1', 'select 1 from public.posts where id = #01'), 'ok1', 'the reporter may lift their own hide');

-- ── Report thresholds (D33, D61) from the settings ──────────────────────────
select is(pg_temp.report('{2}', 'post', '#01') || pg_temp.val('select status from public.posts where id = #01'),
  'okopen', 'two reporters do not hide a post');
select is(pg_temp.report('{3}', 'post', '#01') || pg_temp.val('select status from public.posts where id = #01'),
  'okhidden_pending_review', 'the third distinct reporter hides the post for review');
select is(pg_temp.seen('4', 'select 1 from public.posts where id = #01') || '/' || pg_temp.seen('e', 'select 1 from public.posts where id = #01'),
  '0/1', 'a hidden post is seen by its owner only');
select is(pg_temp.events('post_hidden_for_review') || '/' || pg_temp.events('moderation_review_needed')
  || '/' || pg_temp.val($$select count(*) from public.moderation_queue where target_id = #01 and reason = 'report_threshold' and status = 'open'$$),
  '1/3/1', 'the owner and the three moderating staff are notified, and the case is queued');
select is(pg_temp.resolve('2', 'admin_dismiss_report', '1', '#01') || '|' || pg_temp.resolve('c', 'admin_dismiss_report', '1', '#01'),
  '42501|42501', 'members and support staff cannot resolve a report');
select is(pg_temp.resolve('b', 'admin_dismiss_report', '1', '#01')
  || pg_temp.val($$select p.status || '/' || q.status from public.posts p, public.moderation_queue q where p.id = #01 and q.target_id = #01$$),
  'okopen/resolved', 'a dismissal that breaks the threshold restores the post and closes the case');
select is(pg_temp.act('b', format('select public.admin_dismiss_report(%L)',
    pg_temp.val($$select id from public.reports where reporter_id = @1 and target_id = #01$$))), 'report_not_open', 'a report is resolved once');
update kc_private.moderation_settings set content_hide_reporters = 2;
select is(pg_temp.report('{4,5}', 'post', '#02') || pg_temp.val('select status from public.posts where id = #02'),
  'okhidden_pending_review', 'the threshold is a setting, not a literal');
select is(pg_temp.resolve('b', 'admin_confirm_report', '4', '#02')
  || pg_temp.val($$select status || '/' || status_before_removal from public.posts where id = #02$$),
  'okremoved_admin/open', 'confirming a violation removes a post hidden for review');
select is(pg_temp.report('{2,3,4,5}', 'user', '@7') || pg_temp.val('select status from public.user_account where user_id = @7'),
  'okactive', 'four reporters do not suspend a member');
select is(pg_temp.report('{6}', 'user', '@7')
  || pg_temp.val($$select a.status || '/' || s.reason || '/' || (s.issued_by is null) from public.user_account a
       join public.user_sanctions s on s.user_id = a.user_id and s.lifted_at is null where a.user_id = @7$$),
  'oksuspended_admin/report_threshold/true', 'the fifth distinct reporter suspends the member');
select is(pg_temp.resolve('b', 'admin_dismiss_report', '6', '@7')
  || pg_temp.val($$select a.status || '/' || count(s.lifted_at) from public.user_account a
       join public.user_sanctions s on s.user_id = a.user_id where a.user_id = @7 group by a.status$$),
  'okactive/1', 'one rule imposes and lifts: below the threshold the suspension ends (D134)');
select is(pg_temp.act('8', 'select public.request_account_deletion()') || pg_temp.report('{2,3,4,5,6}', 'user', '@8')
  || pg_temp.val('select status from public.user_account where user_id = @8'),
  'okokpending_deletion', 'reports on a member who is leaving succeed and do not cancel the deletion');
select is(pg_temp.report('{2,3,4}', 'comment', $$'50000000-0000-4000-8000-000000000001'$$)
  || pg_temp.val($$select status from public.post_comments where id = '50000000-0000-4000-8000-000000000001'$$)
  || pg_temp.seen('2', 'select 1 from public.post_comments') || pg_temp.seen('1', 'select 1 from public.post_comments'),
  'okactive01', 'a reported comment waits for staff and is hidden from its reporters');
select is(pg_temp.act('2', $$select public.admin_delete_comment('50000000-0000-4000-8000-000000000001')$$) || '|'
  || pg_temp.act('b', $$select public.admin_delete_comment('50000000-0000-4000-8000-000000000001')$$) || '|'
  || pg_temp.val($$select status from public.post_comments where id = '50000000-0000-4000-8000-000000000001'$$) || '|'
  || pg_temp.seen('1', 'select 1 from public.post_comments') || pg_temp.seen('c', 'select 1 from public.post_comments'),
  '42501|ok|deleted|01', 'a moderator deletes a comment; the row stays readable to staff');
select is(pg_temp.report('{2,3,4}', 'chat', $$'70000000-0000-4000-8000-000000000001'$$)
  || pg_temp.val($$select count(*) from kc_private.outbox_events where topic = 'moderation_target' and payload ->> 'kind' = 'hide'$$),
  'ok1', 'a chat over the threshold is handed to the messaging module once');

-- ── The report machine ──────────────────────────────────────────────────────
select throws_ok($$update public.reports set status = 'confirmed_violation', resolved_at = now() where status = 'open'$$,
  'P0001', 'forbidden_role', 'a report is resolved in the admin role only');
do $$ begin perform set_config('kc.fsm_role', 'admin', true); end $$;
select throws_ok($$update public.reports set status = 'open', resolved_at = null where status = 'confirmed_violation'$$,
  'P0001', 'illegal_transition', 'a resolved report is not reopened');
select throws_ok($$update public.reports set status = 'escalated' where status = 'open'$$,
  'P0001', 'unknown_state', 'a report has no other status');
do $$ begin perform set_config('kc.fsm_role', '', true); end $$;

-- ── False-report ladder (FR-MOD-010, D135) and the expiry sweep ─────────────
select is(pg_temp.report('{1}', 'post', '#10') || pg_temp.report('{1}', 'post', '#11') || pg_temp.report('{1}', 'post', '#12')
  || pg_temp.resolve('b', 'admin_dismiss_report', '1', '#10') || pg_temp.resolve('b', 'admin_dismiss_report', '1', '#11')
  || pg_temp.resolve('b', 'admin_dismiss_report', '1', '#12')
  || pg_temp.val($$select status || '/' || false_reports_count from public.user_account where user_id = @1$$),
  'okokokokokokactive/4', 'four dismissed reports are counted and sanction nobody');
select is(pg_temp.report('{1}', 'post', '#13') || pg_temp.resolve('b', 'admin_dismiss_report', '1', '#13')
  || pg_temp.val($$select status || '/' || false_report_sanction_count || '/' || (status_until::date - current_date)
       from public.user_account where user_id = @1$$),
  'okoksuspended_for_false_reports/1/7', 'the fifth dismissed report suspends the reporter for seven days');
select is(pg_temp.val($$select count(*) from public.reports where reporter_id = @1 and sanction_consumed_at is not null$$),
  '5', 'the counted reports are consumed');
select is(pg_temp.report('{1}', 'post', '#14'), '42501', 'a suspended member cannot report');
select is(kc_private.lift_expired_suspensions(), 0, 'the sweep leaves a running suspension alone');
update public.user_account set status_until = now() - interval '1 minute' where user_id = '00000000-0000-4000-8000-000000000001';
select is(kc_private.lift_expired_suspensions()::text
  || pg_temp.val($$select a.status || '/' || coalesce(a.status_until::text, '-') || '/' || count(s.lifted_at)
       from public.user_account a join public.user_sanctions s on s.user_id = a.user_id where a.user_id = @1
      group by a.status, a.status_until$$),
  '1active/-/1', 'the sweep lifts an expired suspension and closes its sanction');
update kc_private.moderation_settings set false_report_threshold = 1;
select is(pg_temp.report('{1}', 'post', '#14')
  || pg_temp.act('b', $$select public.admin_suspend_user(@1, 'spam', now() + interval '3 days', 'repeat offender')$$)
  || pg_temp.resolve('b', 'admin_dismiss_report', '1', '#14')
  || pg_temp.val($$select status || '/' || false_report_sanction_count from public.user_account where user_id = @1$$),
  'okokoksuspended_admin/2', 'a sanction never replaces a heavier state, and its level still counts');
select is(pg_temp.act('b', 'select public.admin_restore_user(@1)') || pg_temp.report('{1}', 'user', '@2')
  || pg_temp.resolve('b', 'admin_dismiss_report', '1', '@2')
  || pg_temp.val($$select status || '/' || false_report_sanction_count || '/' || coalesce(status_until::text, 'open-ended')
       from public.user_account where user_id = @1$$),
  'okokoksuspended_for_false_reports/3/open-ended', 'the third level is open-ended');
select is(pg_temp.act('b', 'select public.admin_restore_user(@1)') || pg_temp.val('select status from public.user_account where user_id = @1'),
  'okactive', 'a moderator lifts the open-ended sanction');

-- ── Removing and restoring posts (D129) ─────────────────────────────────────
do $$ begin perform set_config('kc.fsm_role', 'owner', true); end $$;
update public.posts set status = 'paused' where id = '10000000-0000-4000-8000-000000000004';
update public.posts set status = 'closed_delivered' where id = '10000000-0000-4000-8000-000000000005';
update public.posts set status = 'deleted_no_recipient' where id = '10000000-0000-4000-8000-000000000006';
do $$ begin perform set_config('kc.fsm_role', 'system', true); end $$;
update public.posts set status = 'expired' where id = '10000000-0000-4000-8000-000000000007';
do $$ begin perform set_config('kc.fsm_role', '', true); end $$;
select is(pg_temp.seen('2', 'select 1 from public.post_media where post_id = #03'), 1::bigint, 'a member sees the media of an open post');
select is(pg_temp.act('2', 'select public.admin_remove_post(#03)') || pg_temp.act('c', 'select public.admin_remove_post(#03)'),
  '4250142501', 'members and support staff cannot remove a post');
select is(
  (select string_agg(pg_temp.act('b', format('select public.admin_remove_post(#%s)', n))
            || ':' || pg_temp.val(format('select status || ''<'' || status_before_removal from public.posts where id = #%s', n)), ' ' order by n)
     from unnest(array['03', '04', '05', '06', '07']) n),
  'ok:removed_admin<open ok:removed_admin<paused ok:removed_admin<closed_delivered ok:removed_admin<deleted_no_recipient ok:removed_admin<expired',
  'a moderator removes a post in any published status, and the status is remembered');
select is(pg_temp.seen('2', 'select 1 from public.post_media where post_id = #03') || '/' || pg_temp.seen('2', 'select 1 from public.posts where id = #03')
  || '/' || pg_temp.seen('e', 'select 1 from public.posts where id = #03'), '0/0/1', 'a removed post and its media are hidden from everyone but the owner');
select is(pg_temp.act('b', 'select public.admin_remove_post(#03)')
  || pg_temp.val($$select count(*) from audit.events where action = 'manual_remove_target' and target_id = #03$$),
  'ok1', 'removing a removed post is a no-op without a second audit row');
select is(pg_temp.act('b', 'select public.admin_remove_post(#08)') || '|' || pg_temp.act('b', 'select public.admin_remove_post(gen_random_uuid())'),
  'invalid_target_state|target_not_found', 'a draft or a missing post is not removed');
select is(
  (select string_agg(pg_temp.act('b', format('select public.admin_restore_post(#%s)', n))
            || ':' || pg_temp.val(format('select status || ''<'' || coalesce(status_before_removal, ''-'') from public.posts where id = #%s', n)), ' ' order by n)
     from unnest(array['03', '04', '05', '06', '07']) n),
  'ok:open<- ok:paused<- ok:closed_delivered<- ok:deleted_no_recipient<- ok:expired<-',
  'a restore returns each post to the status it was removed from');
select is(pg_temp.act('b', 'select public.admin_restore_post(#03)') || pg_temp.events('post_removed') || '/' || pg_temp.events('post_restored'),
  'ok6/6', 'restoring a live post is a no-op, and the owner is told about each removal and restore');

-- ── Suspending, banning and restoring members (D133) ────────────────────────
select is(pg_temp.act('b', $$select public.admin_ban_user(@3, 'spam')$$) || pg_temp.act('d', $$select public.admin_ban_user(@3, 'spam')$$),
  '4250142501', 'only the super admin bans');
select is(pg_temp.act('a', $$select public.admin_ban_user(@a, 'spam')$$) || '|' || pg_temp.act('a', $$select public.admin_ban_user(@c, 'spam')$$)
  || '|' || pg_temp.act('a', $$select public.admin_ban_user(@8, 'spam')$$) || '|' || pg_temp.act('a', $$select public.admin_ban_user(@3, 'because')$$)
  || '|' || pg_temp.act('a', $$select public.admin_ban_user(gen_random_uuid(), 'spam')$$),
  'cannot_sanction_self|cannot_sanction_admin|account_pending_deletion|invalid_sanction_reason|target_not_found',
  'a ban is validated; an account under deletion is not banned');
select is(pg_temp.act('a', $$select public.admin_ban_user(@3, 'harassment', 'abusive messages')$$)
  || pg_temp.val($$select a.status || '/' || s.kind || '/' || s.reason || '/' || (s.issued_by = @a) || '/' || u.is_active
       from public.user_account a join public.user_sanctions s on s.user_id = a.user_id and s.lifted_at is null
       join public.users u on u.id = a.user_id where a.user_id = @3$$),
  'okbanned/ban/harassment/true/false', 'a ban moves the account and records the sanction');
select is(pg_temp.act('a', $$select public.admin_ban_user(@3, 'spam')$$)
  || pg_temp.val('select count(*) from public.user_sanctions where user_id = @3'), 'ok1', 'banning a banned member is a no-op');
select is(pg_temp.act('b', 'select public.admin_restore_user(@3)'), '42501', 'a moderator cannot lift a ban');
select is(pg_temp.act('a', 'select public.admin_restore_user(@3)')
  || pg_temp.val($$select a.status || '/' || (s.lifted_by = @a) from public.user_account a
       join public.user_sanctions s on s.user_id = a.user_id where a.user_id = @3$$),
  'okactive/true', 'the super admin lifts a ban');
select is(pg_temp.act('c', $$select public.admin_suspend_user(@4, 'spam')$$) || '|'
  || pg_temp.act('b', $$select public.admin_suspend_user(@4, 'spam', now() - interval '1 day')$$) || '|'
  || pg_temp.act('b', $$select public.admin_suspend_user(@4, 'policy_violation', now() + interval '2 days')$$) || '|'
  || pg_temp.act('b', $$select public.admin_suspend_user(@4, 'spam')$$) || '|'
  || pg_temp.val($$select status || '/' || (status_until::date - current_date) from public.user_account where user_id = @4$$),
  '42501|invalid_target_state|ok|invalid_target_state|suspended_admin/2', 'a moderator suspends a member until a date');
select is(pg_temp.act('b', 'select public.admin_restore_user(@4)') || pg_temp.act('b', 'select public.admin_restore_user(@4)')
  || '|' || pg_temp.act('b', 'select public.admin_restore_user(@8)')
  || '|' || pg_temp.val('select status from public.user_account where user_id = @4'),
  'okok|invalid_restore_state|active', 'a moderator lifts a suspension; restoring an active member is a no-op');
select is(pg_temp.act('a', $$select public.admin_ban_user(@b, 'spam')$$) || pg_temp.act('a', 'select public.admin_revoke_role(~b/moderator)')
  || pg_temp.act('a', $$select public.admin_suspend_user(@b, 'other')$$) || pg_temp.act('b', 'select public.admin_remove_post(#03)'),
  'cannot_sanction_adminokok42501', 'staff are sanctioned only after their role is revoked, and then hold no powers');

-- ── The review queue ────────────────────────────────────────────────────────
do $$
begin
  perform kc_private.outbox_enqueue('moderation', jsonb_build_object(
    'kind', 'excessive_reopens', 'post_id', '10000000-0000-4000-8000-000000000009', 'owner_id', gen_random_uuid(), 'reopen_count', 5));
  perform kc_private.outbox_enqueue('moderation', '{"kind":"something_else"}');
end $$;
select is(kc_private.moderation_consume_outbox()::text
  || pg_temp.val($$select reason || '/' || (metadata ->> 'reopen_count') from public.moderation_queue where target_id = #09$$)
  || pg_temp.val($$select '/' || count(*) from kc_private.outbox_events where topic = 'moderation' and processed_at is null and last_error is not null$$),
  '1excessive_reopens/5/1', 'a reopen flag becomes a queue entry; an unknown kind is kept with its error');
select is(pg_temp.act('2', 'select public.admin_assign_queue_entry((select id from public.moderation_queue where target_id = #09))')
  || '|' || pg_temp.act('d', 'select public.admin_assign_queue_entry((select id from public.moderation_queue where target_id = #09), @2)')
  || '|' || pg_temp.act('d', 'select public.admin_assign_queue_entry((select id from public.moderation_queue where target_id = #09))')
  || '|' || pg_temp.val('select assignee_id = @d from public.moderation_queue where target_id = #09'),
  '42501|assignee_not_staff|ok|true', 'staff take a queue entry; it is assigned to staff only');
select is(pg_temp.act('d', 'select public.admin_resolve_queue_entry((select id from public.moderation_queue where target_id = #09))')
  || '|' || pg_temp.act('d', 'select public.admin_resolve_queue_entry((select id from public.moderation_queue where target_id = #09))')
  || '|' || pg_temp.val('select status || (resolved_by = @d) from public.moderation_queue where target_id = #09'),
  'ok|queue_entry_not_open|resolvedtrue', 'an entry is resolved once');
select throws_ok($$update public.moderation_queue set status = 'open', resolved_at = null where status = 'resolved'$$,
  'P0001', 'illegal_transition', 'a resolved entry is not reopened');

-- ── Audit rows of the privileged actions ────────────────────────────────────
select is(
  (select string_agg(distinct action, ' ' order by action) from audit.events),
  'account_status_changed admin_role_grant admin_role_revoke admin_role_set_manager assign_queue_entry auto_remove_target '
  || 'ban_user confirm_report dismiss_report false_report_sanction_applied manual_remove_target org_create post_status_moderated '
  || 'report_target resolve_queue_entry restore_target suspend_user unban_user unsuspend_user',
  'every privileged action and automatic rule left its audit row');
select is(pg_temp.val($$select (actor_id = @a) || '/' || (metadata ->> 'reason') || '/' || (metadata ? 'note')
     from audit.events where action = 'ban_user' and target_id = @3$$), 'true/harassment/false',
  'the audit row names the actor and the reason code, never the free text');
select is(pg_temp.val($$select count(*) filter (where actor_id is null) || '/' || count(*) from audit.events
     where action in ('auto_remove_target', 'false_report_sanction_applied')$$), '8/8', 'automatic rules have no actor');

-- ── Privileges ──────────────────────────────────────────────────────────────
select ok(not has_table_privilege('anon', 'public.reports', 'select')
  and not has_table_privilege('anon', 'public.admin_role_grants', 'select')
  and not has_function_privilege('anon', 'public.admin_ban_user(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'kc_access.is_admin()', 'execute'), 'nothing is open to signed-out callers');
select ok(not has_function_privilege('authenticated', 'kc_private.account_sanction(uuid, text, text, timestamptz, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'kc_private.lift_expired_suspensions()', 'execute')
  and not has_table_privilege('authenticated', 'kc_private.moderation_settings', 'select')
  and not has_table_privilege('authenticated', 'public.user_sanctions', 'insert'), 'internal functions and settings are closed to members');

-- ── Account removal ─────────────────────────────────────────────────────────
delete from auth.users where id in ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003');
select is(pg_temp.val($$select count(*) filter (where reporter_id is null) || '/' || count(*) filter (where reporter_id = @2)
     from public.reports where target_id in (#01, @7, @8)$$)::text, '6/0', 'the reports of a removed member stay, without the reporter');
select is(pg_temp.val($$select (select count(*) from public.report_hides where reporter_id in (@2, @3))
     + (select count(*) from public.user_sanctions where user_id = @3)
     + (select count(*) from public.admin_role_grants where user_id = @2)$$), '0', 'hides, sanctions and grants go with the member');
select is(pg_temp.val($$select count(*) > 0 from audit.events where target_id = @3 or actor_id = @2$$), 'true',
  'audit rows about and by a removed member stay');

select * from finish();
rollback;
