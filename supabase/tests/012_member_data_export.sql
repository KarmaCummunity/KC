-- Identity · self-service data export: public.export_my_data() returns the caller's own rows
-- and nothing of another member, is closed to signed-out callers and is rate limited.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs one statement as a member ('a', 'b') or as the signed-out role ('anon') and returns
-- the first column of the first row as text.
create function pg_temp.run(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_role constant text := case p_who when 'anon' then 'anon' else 'authenticated' end;
  v_sub constant text := case p_who when 'anon' then null else '00000000-0000-4000-8000-00000000000' || p_who end;
  v_out text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_sub, 'role', v_role)::text, true);
  perform set_config('role', v_role, true);
  execute p_sql into v_out;
  perform set_config('role', 'none', true);
  return v_out;
end;
$$;

create function pg_temp.id(p_who text) returns uuid language sql as
  $$select ('00000000-0000-4000-8000-00000000000' || p_who)::uuid$$;

select plan(17);

insert into auth.users (id, email, raw_app_meta_data) values
  (pg_temp.id('a'), 'alice@example.test', '{"provider":"google","providers":["google"]}'),
  (pg_temp.id('b'), 'bob@example.test', '{"provider":"google","providers":["google"]}');
update public.user_private set contact_phone = '+972500000001', date_of_birth = '1990-01-01' where user_id = pg_temp.id('a');
update public.user_private set contact_phone = '+972500000002', date_of_birth = '1991-02-02' where user_id = pg_temp.id('b');
insert into public.user_feedback (user_id, rating, body) values
  (pg_temp.id('a'), 6, 'alice feedback text'),
  (pg_temp.id('b'), 2, 'bob feedback secret');
insert into public.user_devices (user_id, platform, push_token) values
  (pg_temp.id('a'), 'ios', 'push-token-alice'),
  (pg_temp.id('b'), 'ios', 'push-token-bob');
insert into public.user_sanctions (user_id, kind, reason, issued_by) values
  (pg_temp.id('a'), 'suspension', 'spam', pg_temp.id('b'));
insert into public.follows (follower_id, followed_id) values (pg_temp.id('b'), pg_temp.id('a'));

-- ── who may call it ─────────────────────────────────────────────────────────
select ok(not has_function_privilege('public', 'public.export_my_data()', 'execute'),
  'PUBLIC cannot execute the export');
select ok(not has_function_privilege('anon', 'public.export_my_data()', 'execute'),
  'a signed-out caller cannot execute the export');
select ok(has_function_privilege('authenticated', 'public.export_my_data()', 'execute'),
  'a signed-in member can execute the export');
select ok(not has_function_privilege('authenticated', 'kc_private.export_rows(text, uuid)', 'execute'),
  'the query helper is not callable by members');
select throws_ok($$select pg_temp.run('anon', 'select public.export_my_data()::text')$$,
  '42501', null, 'a signed-out call is refused');

-- ── own data only ───────────────────────────────────────────────────────────
create temporary table export_a on commit drop as
  select pg_temp.run('a', 'select public.export_my_data()::text')::jsonb as doc;
grant select on export_a to authenticated;

select is((select doc ->> 'user_id' from export_a), pg_temp.id('a')::text, 'the export names the caller');
select is((select doc #>> '{data,account,0,email}' from export_a), 'alice@example.test',
  'the export carries the account email');
select is((select doc #>> '{data,private_details,0,contact_phone}' from export_a), '+972500000001',
  'the export carries the private details (phone)');
select is((select doc #>> '{data,private_details,0,date_of_birth}' from export_a), '1990-01-01',
  'the export carries the date of birth');
select is((select doc #>> '{data,feedback,0,body}' from export_a), 'alice feedback text',
  'the export carries the member''s own feedback');
select is((select doc #>> '{data,followers,0,follower_id}' from export_a), pg_temp.id('b')::text,
  'the export lists who follows the member');
select ok((select doc::text !~ '(bob@example\.test|\+972500000002|bob feedback secret|push-token-bob)' from export_a),
  'nothing of another member''s own rows is in the export');
select ok((select doc::text !~ '(push-token-alice|"search_vector"|"user_tombstone"|"provider_token"|"idempotency_key")' from export_a),
  'tokens and internal columns are left out');
select ok((select not (doc #> '{data,sanctions,0}') ? 'issued_by' from export_a),
  'the staff member who issued a sanction is not named');

-- ── the other member sees only their own ────────────────────────────────────
select is(pg_temp.run('b', $$select public.export_my_data() #>> '{data,account,0,email}'$$), 'bob@example.test',
  'another member exports their own account');

-- ── rate limit ──────────────────────────────────────────────────────────────
-- The first export above counted once; four more fit in the hour, the sixth is refused.
select is(pg_temp.run('a', 'select count(public.export_my_data()) from generate_series(1, 4)'), '4',
  'a member may export a few times an hour');
select throws_ok($$select pg_temp.run('a', 'select public.export_my_data()::text')$$,
  'P0001', 'rate_limited', 'repeated exports are rate limited');

select * from finish();
rollback;
