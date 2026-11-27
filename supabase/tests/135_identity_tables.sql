-- KC's own identity tables (ADR-013): closed to every client role, removed with the member, and
-- the rule that decides whether a session still proves someone.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(13);

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
