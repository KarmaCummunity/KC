-- KC's own identity tables (ADR-013): closed to every client role, removed with the member, and
-- the rule that decides whether a session still proves someone.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(19);

-- ── Nobody but the service role reaches them ────────────────────────────────────────────────────
select ok(
  (select bool_and(c.relrowsecurity and c.relforcerowsecurity)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kc_private' and c.relname like 'auth\_%' and c.relkind = 'r')
  and (select count(*) = 5 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'kc_private' and c.relname like 'auth\_%' and c.relkind = 'r'),
  'all five identity tables have row security on, forced'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'kc_private' and tablename like 'auth\_%'),
  0,
  'and no policy: a role that does not bypass row security sees no row'
);
select ok(
  not has_schema_privilege('authenticated', 'kc_private', 'usage') and not has_schema_privilege('anon', 'kc_private', 'usage'),
  'a member or a visitor cannot even name them'
);
select ok(
  has_table_privilege('service_role', 'kc_private.auth_sessions', 'select, insert, update, delete')
    and has_table_privilege('service_role', 'kc_private.auth_passwords', 'select, insert, update, delete'),
  'the service role, which the API works as, reads and writes them'
);

-- ── Fixtures: two members, each with an identity, a password, a session, a token and a link ─────
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'alice@identity.test'),
  ('a0000000-0000-4000-8000-000000000002', 'bob@identity.test');
insert into kc_private.auth_identities (user_id, provider, subject) values
  ('a0000000-0000-4000-8000-000000000001', 'email', 'alice@identity.test'),
  ('a0000000-0000-4000-8000-000000000002', 'google', 'google-subject-of-bob');
insert into kc_private.auth_passwords (user_id, hash) values
  ('a0000000-0000-4000-8000-000000000001', 'scrypt$not-a-real-hash-only-a-fixture');
insert into kc_private.auth_sessions (id, user_id) values
  ('5e000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  ('5e000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002');
insert into kc_private.auth_refresh_tokens (token_hash, session_id) values
  (sha256('alice-token'), '5e000000-0000-4000-8000-000000000001'),
  (sha256('bob-token'), '5e000000-0000-4000-8000-000000000002');
insert into kc_private.auth_one_time_tokens (token_hash, user_id, purpose, expires_at) values
  (sha256('alice-link'), 'a0000000-0000-4000-8000-000000000001', 'verify_email', now() + interval '1 day');

-- ── One provider account is one member ──────────────────────────────────────────────────────────
select throws_ok(
  $$insert into kc_private.auth_identities (user_id, provider, subject)
    values ('a0000000-0000-4000-8000-000000000001', 'google', 'google-subject-of-bob')$$,
  '23505', null,
  'a provider account that is already someone''s cannot become another member''s'
);
select throws_ok(
  $$insert into kc_private.auth_refresh_tokens (token_hash, session_id) values ('\x00', '5e000000-0000-4000-8000-000000000001')$$,
  '23514', null,
  'a refresh token is stored as a SHA-256 digest and as nothing else'
);

-- ── Whether a session still proves its member ───────────────────────────────────────────────────
select ok(
  kc_private.auth_session_is_live('5e000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  'a session that was just issued is live for its member'
);
select ok(
  not kc_private.auth_session_is_live('5e000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),
  'and for nobody else'
);
select ok(
  not kc_private.auth_session_is_live('5e000000-0000-4000-8000-0000000000ff', 'a0000000-0000-4000-8000-000000000001'),
  'a session that does not exist is not live'
);

update kc_private.auth_sessions set refreshed_at = now() - interval '30 days' - interval '1 minute'
 where id = '5e000000-0000-4000-8000-000000000001';
select ok(
  not kc_private.auth_session_is_live('5e000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  'a session that was not refreshed for 30 days is not live'
);

update kc_private.auth_sessions set ended_at = now(), ended_reason = 'signed_out'
 where id = '5e000000-0000-4000-8000-000000000002';
select ok(
  not kc_private.auth_session_is_live('5e000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002'),
  'a session that ended is not live'
);
select throws_ok(
  $$update kc_private.auth_sessions set ended_at = now() where id = '5e000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'a session cannot end without a reason'
);

-- ── The member as a session describes them ──────────────────────────────────────────────────────
update auth.users
   set raw_user_meta_data = '{"full_name": "Bob Builder"}', raw_app_meta_data = '{"provider": "google"}', email_confirmed_at = now()
 where id = 'a0000000-0000-4000-8000-000000000002';
-- The service role may not call the test functions, so what it sees is noted while acting as it
-- and asserted afterwards.
set local role service_role;
select set_config(
  'test.session_user',
  (select format('%s|%s|%s|%s', email, email_confirmed_at is not null, meta ->> 'full_name', provider)
     from kc_private.auth_session_user('a0000000-0000-4000-8000-000000000002')),
  true
);
do $$
begin
  perform 1 from auth.users limit 1;
  perform set_config('test.reads_users_table', 'yes', true);
exception when insufficient_privilege then
  perform set_config('test.reads_users_table', 'no', true);
end $$;
reset role;
select is(
  current_setting('test.session_user'),
  'bob@identity.test|t|Bob Builder|google',
  'the service role reads the columns a session needs of a member''s row'
);
select is(current_setting('test.reads_users_table'), 'no', 'and still cannot read the table itself');

-- ── Creating and changing the member's row ──────────────────────────────────────────────────────
set local role service_role;
select set_config('test.new_member', kc_private.auth_user_create('Carol@Identity.Test', 'email', false, '{"full_name": "Carol"}')::text, true);
select set_config('test.found_by_email', kc_private.auth_user_id_by_email('CAROL@identity.test')::text, true);
reset role;
select is(current_setting('test.found_by_email'), current_setting('test.new_member'), 'a member is found by their address in any letter case');
select results_eq(
  $$select u.email, u.email_confirmed_at is null, u.raw_app_meta_data ->> 'provider', a.status::text
      from auth.users u join public.user_account a on a.user_id = u.id
     where u.id = current_setting('test.new_member')::uuid$$,
  $$values ('carol@identity.test', true, 'email', 'pending_verification')$$,
  'a sign-up with an unverified address creates the member, pending, through the table''s own trigger'
);

set local role service_role;
select kc_private.auth_user_confirm_email(current_setting('test.new_member')::uuid);
select kc_private.auth_user_merge_profile(current_setting('test.new_member')::uuid, '{"avatar_url": "https://media.kc.test/carol.jpg"}');
reset role;
select results_eq(
  $$select a.status::text, u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'avatar_url'
      from auth.users u join public.user_account a on a.user_id = u.id
     where u.id = current_setting('test.new_member')::uuid$$,
  $$values ('active', 'Carol', 'https://media.kc.test/carol.jpg')$$,
  'confirming the address activates the account, and a profile change keeps what it does not name'
);
select ok(
  not has_function_privilege('authenticated', 'kc_private.auth_user_create(text, text, boolean, jsonb)', 'execute')
    and not has_function_privilege('anon', 'kc_private.auth_user_confirm_email(uuid)', 'execute'),
  'no client role can call them'
);

-- ── Removed with the member ─────────────────────────────────────────────────────────────────────
delete from auth.users where id = 'a0000000-0000-4000-8000-000000000001';
select is(
  (select (select count(*) from kc_private.auth_identities where user_id = 'a0000000-0000-4000-8000-000000000001')
        + (select count(*) from kc_private.auth_passwords where user_id = 'a0000000-0000-4000-8000-000000000001')
        + (select count(*) from kc_private.auth_sessions where user_id = 'a0000000-0000-4000-8000-000000000001')
        + (select count(*) from kc_private.auth_refresh_tokens where session_id = '5e000000-0000-4000-8000-000000000001')
        + (select count(*) from kc_private.auth_one_time_tokens where user_id = 'a0000000-0000-4000-8000-000000000001'))::int,
  0,
  'deleting the member''s row removes their identities, password, sessions, tokens and links'
);

select * from finish();
rollback;
