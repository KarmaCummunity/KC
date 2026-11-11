-- Identity: member rows are created with the auth account, each role sees and writes only
-- what it may, and the account status moves only along its machine.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs one statement as an API role and returns the number of rows it returned or changed.
-- The role and JWT claims are transaction-local; they are reset before returning, and an
-- exception rolls them back, so every assertion itself runs as the test owner.
create function pg_temp.rows_as(p_role text, p_user_id uuid, p_sql text)
returns bigint
language plpgsql
as $$
declare
  v_rows bigint;
begin
  perform set_config(
    'request.jwt.claims', jsonb_build_object('sub', p_user_id, 'role', p_role)::text, true);
  perform set_config('role', p_role, true);
  execute p_sql;
  get diagnostics v_rows = row_count;
  perform set_config('role', 'none', true);
  return v_rows;
end;
$$;

select plan(32);

-- Three sign-ups: confirmed email, unconfirmed email, Google.
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test', now(), '{"provider":"email"}', null),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test', null, '{"provider":"email"}', null),
  ('00000000-0000-4000-8000-00000000000c', 'carol@example.test', null, '{"provider":"google"}',
   '{"full_name":"Carol Cohen","picture":"https://example.test/c.jpg"}');

-- ── Rows created by the sign-up trigger ─────────────────────────────────────
select is(
  (select count(*) from public.users u
     join public.user_private p on p.user_id = u.id
     join public.user_account a on a.user_id = u.id
     join public.user_stats s on s.user_id = u.id),
  3::bigint, 'every sign-up gets its four member rows');
select is((select status from public.user_account where user_id = '00000000-0000-4000-8000-00000000000a'),
  'active', 'a confirmed email account starts active');
select is((select status from public.user_account where user_id = '00000000-0000-4000-8000-00000000000b'),
  'pending_verification', 'an unconfirmed email account waits for verification');
select is((select status from public.user_account where user_id = '00000000-0000-4000-8000-00000000000c'),
  'active', 'a Google account starts active');
select is((select array_agg(is_active order by id) from public.users),
  array[true, false, true], 'users.is_active mirrors the account status');
select is(
  (select count(distinct share_handle) filter (where share_handle ~ '^u_[0-9a-f]{12}$') from public.users),
  3::bigint, 'each member gets a distinct, well-formed share handle');
select is((select display_name from public.users where id = '00000000-0000-4000-8000-00000000000a'),
  'alice', 'the display name falls back to the email local part');
select is((select display_name || '|' || avatar_url from public.users where id = '00000000-0000-4000-8000-00000000000c'),
  'Carol Cohen|https://example.test/c.jpg', 'provider name and picture seed the profile');

-- ── Read access ─────────────────────────────────────────────────────────────
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a', 'select 1 from public.users'),
  2::bigint, 'a member sees active profiles only');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000b', 'select 1 from public.users'),
  3::bigint, 'a member always sees their own profile, even when not active');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a', 'select 1 from public.user_private'),
  1::bigint, 'a member reads only their own private row');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a', 'select 1 from public.user_account'),
  1::bigint, 'a member reads only their own account row');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a', 'select user_id from public.user_stats'),
  2::bigint, 'counters are visible exactly for visible profiles');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a', 'select open_posts_only_me from public.user_stats')$$,
  '42501', null, 'the private post count is not selectable');
select throws_ok(
  $$select pg_temp.rows_as('anon', null, 'select 1 from public.users')$$,
  '42501', null, 'a signed-out caller cannot read profiles');
select throws_ok(
  $$select pg_temp.rows_as('anon', null, 'select 1 from public.cities')$$,
  '42501', null, 'a signed-out caller cannot read reference data');

-- ── Write access ────────────────────────────────────────────────────────────
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
    $$update public.users set display_name = 'Alice'$$),
  1::bigint, 'a member updates only their own profile');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
    $$update public.user_private set show_active_status = false$$),
  1::bigint, 'a member updates only their own preferences');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a', 'update public.users set share_handle = ''alice''')$$,
  '42501', null, 'the share handle is not client-writable');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000b', 'update public.users set is_active = true')$$,
  '42501', null, 'a member cannot activate themselves');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000b', 'update public.user_account set status = ''active''')$$,
  '42501', null, 'account state is not client-writable');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a', 'update public.user_private set date_of_birth = ''2000-01-01''')$$,
  '42501', null, 'date of birth is not directly writable');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a', 'delete from public.users')$$,
  '42501', null, 'a member cannot delete profile rows');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a', 'update public.users set biography = ''see www.example.test''')$$,
  '23514', null, 'a biography with a link is rejected');

select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
    $$update public.user_private set profile_street = 'Herzl', profile_street_number = '12' || chr(1488)$$),
  1::bigint, 'a house number may end with a Hebrew entrance letter');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a', 'update public.user_private set profile_street_number = ''12-14''')$$,
  '23514', null, 'a malformed house number is rejected');

-- ── Account status machine ──────────────────────────────────────────────────
select throws_ok(
  $$update public.user_account set status = 'pending_verification' where user_id = '00000000-0000-4000-8000-00000000000a'$$,
  'P0001', 'illegal_transition', 'active cannot return to pending_verification');
select throws_ok(
  $$update public.user_account set status = 'deleted' where user_id = '00000000-0000-4000-8000-00000000000a'$$,
  'P0001', 'unknown_state', 'a status outside the machine is rejected');
select throws_ok(
  $$update public.user_account set status = 'pending_deletion' where user_id = '00000000-0000-4000-8000-00000000000a'$$,
  '23514', null, 'pending_deletion requires its purge date');

update auth.users set email_confirmed_at = now() where id = '00000000-0000-4000-8000-00000000000b';
select is(
  (select a.status || '|' || u.is_active from public.user_account a join public.users u on u.id = a.user_id
    where a.user_id = '00000000-0000-4000-8000-00000000000b'),
  'active|true', 'confirming the email activates a waiting member');

update public.user_account set status = 'banned' where user_id = '00000000-0000-4000-8000-00000000000a';
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000c', 'select 1 from public.users'),
  2::bigint, 'a banned member disappears from other members at once');

-- ── Account removal ─────────────────────────────────────────────────────────
delete from auth.users where id = '00000000-0000-4000-8000-00000000000c';
select is(
  (select count(*) from public.users where id = '00000000-0000-4000-8000-00000000000c')
  + (select count(*) from public.user_private where user_id = '00000000-0000-4000-8000-00000000000c')
  + (select count(*) from public.user_account where user_id = '00000000-0000-4000-8000-00000000000c')
  + (select count(*) from public.user_stats where user_id = '00000000-0000-4000-8000-00000000000c'),
  0::bigint, 'removing the auth account removes every member row');

select * from finish();
rollback;
