-- Identity extras: devices, legal documents and consents, onboarding, date of birth, the
-- 30-day account deletion flow and the session bootstrap.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs one statement as a member ('a'…'d') or as the signed-out role ('anon'). `@a` in the
-- statement stands for that member's id. Returns the first column of the first row, or the
-- number of rows changed when the statement returns nothing.
create function pg_temp.run(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_role constant text := case p_who when 'anon' then 'anon' else 'authenticated' end;
  v_sub constant text := case p_who when 'anon' then null else '00000000-0000-4000-8000-00000000000' || p_who end;
  v_out text;
  v_rows bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_sub, 'role', v_role)::text, true);
  perform set_config('role', v_role, true);
  p_sql := regexp_replace(p_sql, '@([a-d])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
  if p_sql ~* '^\s*select|\sreturning\s' then
    execute p_sql into v_out;
  else
    execute p_sql;
  end if;
  get diagnostics v_rows = row_count;
  perform set_config('role', 'none', true);
  return coalesce(v_out, v_rows::text);
end;
$$;

create function pg_temp.id(p_who text) returns uuid language sql as
  $$select ('00000000-0000-4000-8000-00000000000' || p_who)::uuid$$;

select plan(72);

-- a, b, c are active (Google); d still waits for email confirmation.
insert into auth.users (id, email, raw_app_meta_data) values
  (pg_temp.id('a'), 'alice@example.test', '{"provider":"google"}'),
  (pg_temp.id('b'), 'bob@example.test', '{"provider":"google"}'),
  (pg_temp.id('c'), 'carol@example.test', '{"provider":"google"}'),
  (pg_temp.id('d'), 'dan@example.test', '{"provider":"email"}');
insert into public.cities (city_id, name_he, name_en) values ('5000', 'x', 'Tel Aviv');

-- ── user_devices ────────────────────────────────────────────────────────────
select is(pg_temp.run('a', $$insert into public.user_devices (user_id, platform, push_token) values (@a, 'ios', 'tok-a')$$),
  '1', 'a member registers a device');
select throws_ok($$select pg_temp.run('a', 'insert into public.user_devices (user_id, platform, push_token) values (@b, ''ios'', ''tok-x'')')$$,
  '42501', null, 'a device cannot be registered for another member');
select is(pg_temp.run('a', $$insert into public.user_devices (user_id, platform, push_token) values (@a, 'ios', 'tok-a')
    on conflict (push_token) do update set last_seen_at = now() + interval '1 minute' returning (last_seen_at > created_at)::text$$),
  'true', 'registering the same token again refreshes last_seen_at');
select throws_ok($$select pg_temp.run('b', 'insert into public.user_devices (user_id, platform, push_token) values (@b, ''ios'', ''tok-a'')')$$,
  '23505', null, 'a push token belongs to one member at a time');
select throws_ok($$select pg_temp.run('a', 'insert into public.user_devices (user_id, platform, push_token) values (@a, ''tv'', ''tok-b'')')$$,
  '23514', null, 'an unknown platform is rejected');
select is(pg_temp.run('b', 'select count(*) from public.user_devices'), '0', 'devices are invisible to other members');
select is(pg_temp.run('b', 'delete from public.user_devices'), '0', 'another member cannot remove a device');
select throws_ok($$select pg_temp.run('anon', 'select 1 from public.user_devices')$$,
  '42501', null, 'a signed-out caller cannot read devices');

-- ── legal documents ─────────────────────────────────────────────────────────
insert into public.legal_documents
  (doc_type, current_version, current_effective_date, last_material_version, last_material_severity) values
  ('terms', 2, now() - interval '1 day', 2, 'standard'),
  ('privacy', 1, now() - interval '1 day', 1, 'critical');
insert into public.legal_document_versions (doc_type, version, effective_date, body_md, severity, change_summary, published_by) values
  ('terms', 1, now() - interval '9 days', 'Terms v1', 'standard', 'first', pg_temp.id('c')),
  ('terms', 2, now() - interval '1 day', 'Terms v2', 'standard', 'second', pg_temp.id('c')),
  ('privacy', 1, now() - interval '1 day', 'Privacy v1', 'critical', 'first', pg_temp.id('c'));

select is((select content_hash from public.legal_document_versions where doc_type = 'terms' and version = 2),
  encode(sha256('Terms v2'::bytea), 'hex'), 'the content hash is computed by the server');
select throws_ok($$update public.legal_document_versions set body_md = 'changed' where version = 2$$,
  'P0001', 'append_only', 'a published version cannot be edited, even by server code');
select throws_ok($$delete from public.legal_document_versions where version = 1$$,
  'P0001', 'append_only', 'a published version cannot be deleted');
select is(pg_temp.run('a', 'select count(*) from public.legal_document_versions'), '3', 'a member reads every published version');
select is(pg_temp.run('anon', 'select count(*) from public.legal_document_versions'), '3',
  'a signed-out caller reads the published legal text (sign-up screen)');
select throws_ok($$select pg_temp.run('anon', 'update public.legal_documents set current_version = 9')$$,
  '42501', null, 'a signed-out caller cannot change legal documents');
select throws_ok($$select pg_temp.run('a', 'update public.legal_documents set current_version = 9')$$,
  '42501', null, 'a member cannot write legal documents');

-- ── user_consents ───────────────────────────────────────────────────────────
set local "request.headers" = '{"x-forwarded-for":"203.0.113.7, 10.0.0.1"}';
select ok(pg_temp.run('a', $$select public.accept_legal_document('terms', 2, 'he', 'TestAgent/1.0') ->> 'acceptance_id'$$) is not null,
  'a member accepts the current version of a document');
select is(
  (select consent_kind || '|' || version || '|' || locale || '|' || host(ip_address) || '|' || user_agent
     from public.user_consents where user_id = pg_temp.id('a')),
  'terms|2|he|203.0.113.7|TestAgent/1.0', 'the consent stores version, locale, device address and user agent');
select lives_ok(format('select pg_temp.run(%L, %L)', 'a', $$select public.accept_legal_document('terms', 2)$$),
  'accepting the same version again succeeds');
select is((select count(*) from public.user_consents), 1::bigint, 'accepting the same version twice keeps one row');
select throws_ok($$select pg_temp.run('a', 'select public.accept_legal_document(''terms'', 1)')$$,
  'P0001', 'legal_version_out_of_range', 'a version older than the last material one does not satisfy the gate');
select throws_ok($$select pg_temp.run('a', 'select public.accept_legal_document(''terms'', 3)')$$,
  'P0001', 'legal_version_out_of_range', 'an unpublished version cannot be accepted');
select throws_ok($$select pg_temp.run('a', 'select public.accept_legal_document(''cookies'', 1)')$$,
  'P0001', 'unknown_legal_document', 'an unknown document is rejected');
select throws_ok($$select pg_temp.run('a', 'insert into public.user_consents (user_id, consent_kind, version) values (@a, ''privacy'', 1)')$$,
  '42501', null, 'a consent cannot be inserted from a device');
select throws_ok($$select pg_temp.run('a', 'delete from public.user_consents')$$,
  '42501', null, 'a consent cannot be deleted from a device');
select throws_ok($$update public.user_consents set version = 1$$, 'P0001', 'append_only', 'a consent cannot be changed by server code');
select throws_ok($$delete from public.user_consents$$, 'P0001', 'append_only', 'a consent cannot be deleted on its own');
select is(pg_temp.run('b', 'select count(*) from public.user_consents'), '0', 'consents are invisible to other members');
select is((kc_private.record_consent(pg_temp.id('b'), 'driver_declaration', 1, null, null)).consent_kind,
  'driver_declaration', 'world modules record their consents in the same table');
select throws_ok($$select kc_private.record_consent(pg_temp.id('b'), 'newsletter', 1, null, null)$$,
  '23514', null, 'an unknown consent kind is rejected');

-- ── bootstrap_session ───────────────────────────────────────────────────────
select is(
  (select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.run('a', 'select public.bootstrap_session()')::jsonb) k),
  'account,legal,private_profile,unread,user_id', 'bootstrap returns one key per concern');
select is(pg_temp.run('a', $$select public.bootstrap_session() -> 'account' ->> 'status'$$), 'active', 'bootstrap carries the account gate');
select is(pg_temp.run('a', $$select (public.bootstrap_session() -> 'private_profile' ? 'date_of_birth')::text$$),
  'true', 'bootstrap carries the private profile');
select is(pg_temp.run('a', $$select public.bootstrap_session() -> 'legal' ->> 'documents'$$)::jsonb #>> '{0,doc_type}',
  'privacy', 'a document the member accepted is not asked for again');
select is(pg_temp.run('a', $$select public.bootstrap_session() -> 'legal' ->> 'blocking'$$), 'true', 'a critical change blocks the app');
select is(pg_temp.run('b', $$select jsonb_array_length(public.bootstrap_session() -> 'legal' -> 'documents')::text$$),
  '2', 'a member with no consent owes every document in force');
select lives_ok(format('select pg_temp.run(%L, %L)', 'a', $$select public.accept_legal_document('privacy', 1)$$),
  'the member accepts the privacy policy');
select is(pg_temp.run('a', $$select public.bootstrap_session() ->> 'legal'$$)::jsonb,
  '{"needs_reacknowledgement": false, "blocking": false, "documents": []}'::jsonb, 'after accepting everything nothing is owed');
set local "request.jwt.claims" = '{}';
select throws_ok($$select public.bootstrap_session()$$, '42501', 'unauthenticated', 'bootstrap needs a signed-in caller');
select throws_ok($$select pg_temp.run('anon', 'select public.bootstrap_session()')$$, '42501', null, 'a signed-out caller cannot call bootstrap');

-- ── date of birth and onboarding ────────────────────────────────────────────
select throws_ok($$select pg_temp.run('a', 'select public.set_onboarding_state(''pending_avatar'')')$$,
  'P0001', 'onboarding_basic_info_missing', 'step 1 cannot be left without city and date of birth');
select throws_ok(format($$select pg_temp.run('a', 'select public.set_date_of_birth(''%s'')')$$, (current_date - interval '17 years')::date),
  'P0001', 'underage', 'a member under 18 is rejected');
select throws_ok(format($$select pg_temp.run('a', 'select public.set_date_of_birth(''%s'')')$$, current_date + 1),
  'P0001', 'invalid_date_of_birth', 'a date in the future is rejected');
select throws_ok($$select pg_temp.run('a', 'select public.set_date_of_birth(null)')$$,
  'P0001', 'invalid_date_of_birth', 'an empty date is rejected');
select lives_ok(format('select pg_temp.run(%L, %L)', 'a', format('select public.set_date_of_birth(%L)', (current_date - interval '18 years')::date)),
  'a valid date of birth is stored');
select is((select date_of_birth from public.user_private where user_id = pg_temp.id('a')),
  (current_date - interval '18 years')::date, 'a member who is 18 today is accepted');
select lives_ok(format('select pg_temp.run(%L, %L)', 'a', $$update public.users set city_id = '5000'$$),
  'the member sets a city');
select lives_ok($$select pg_temp.run('a', 'select public.set_onboarding_state(''pending_avatar'')')$$,
  'with name, city and date of birth the member leaves step 1');
select throws_ok($$select pg_temp.run('a', 'select public.set_onboarding_state(''pending_basic_info'')')$$,
  'P0001', 'onboarding_transition_invalid', 'onboarding never moves backwards');
select throws_ok($$select pg_temp.run('a', 'select public.set_onboarding_state(''done'')')$$,
  'P0001', 'onboarding_transition_invalid', 'a state outside the machine is rejected');
select lives_ok(format('select pg_temp.run(%L, %L)', 'a', $$select public.set_onboarding_state('completed')$$),
  'the member finishes onboarding');
select is((select onboarding_state from public.user_account where user_id = pg_temp.id('a')), 'completed', 'onboarding completes');
select throws_ok($$select pg_temp.run('b', 'select public.set_onboarding_state(''completed'')')$$,
  'P0001', 'onboarding_basic_info_missing', 'the deferred path to completed needs the step 1 fields too');

-- ── account deletion: request → hidden → restore ────────────────────────────
select ok(pg_temp.run('a', 'select public.request_account_deletion()')::timestamptz
    between now() + interval '30 days' - interval '1 minute' and now() + interval '30 days',
  'a deletion request returns a purge date 30 days ahead');
select is(
  (select status || '|' || status_before_deletion from public.user_account where user_id = pg_temp.id('a')),
  'pending_deletion|active', 'the account is pending deletion and remembers its status');
select is((select count(*) from public.user_devices where user_id = pg_temp.id('a')), 0::bigint, 'push tokens are dropped at once');
select is(pg_temp.run('b', 'select count(*) from public.users where id = @a'), '0', 'the profile disappears for other members at once');
select is(pg_temp.run('a', 'select public.request_account_deletion()')::timestamptz,
  (select deletion_purge_at from public.user_account where user_id = pg_temp.id('a')), 'a repeated request keeps the purge date');
select is(pg_temp.run('a', $$select public.bootstrap_session() -> 'account' ->> 'deletion_purge_at'$$)::timestamptz,
  (select deletion_purge_at from public.user_account where user_id = pg_temp.id('a')), 'bootstrap tells the restore screen the purge date');
select lives_ok(format('select pg_temp.run(%L, %L)', 'a', 'select public.restore_account()'),
  'the member restores the account');
select is(
  (select a.status || '|' || u.is_active || '|' || (a.deletion_purge_at is null and a.deletion_requested_at is null and a.status_before_deletion is null)
     from public.user_account a join public.users u on u.id = a.user_id where a.user_id = pg_temp.id('a')),
  'active|true|true', 'a restore returns the account, visible, with the deletion fields cleared');
select throws_ok($$select pg_temp.run('a', 'select public.restore_account()')$$,
  'P0001', 'not_pending_deletion', 'only an account pending deletion can be restored');

-- A member who confirmed their email while pending deletion returns as active.
select lives_ok(format('select pg_temp.run(%L, %L)', 'd', 'select public.request_account_deletion()'),
  'a member waiting for verification may request deletion');
update auth.users set email_confirmed_at = now() where id = pg_temp.id('d');
select lives_ok(format('select pg_temp.run(%L, %L)', 'd', 'select public.restore_account()'),
  'the member restores after confirming the email');
select is((select status from public.user_account where user_id = pg_temp.id('d')), 'active',
  'a restore honours a verification that arrived during the grace period');

update public.user_account set status = 'banned' where user_id = pg_temp.id('c');
select throws_ok($$select pg_temp.run('c', 'select public.request_account_deletion()')$$,
  'P0001', 'suspended', 'a sanctioned member cannot delete the account');

-- ── account deletion: request → due for purge ───────────────────────────────
select lives_ok(format('select pg_temp.run(%L, %L)', 'b', 'select public.request_account_deletion()'),
  'another member requests deletion');
select is((select count(*) from kc_private.accounts_due_for_purge()), 0::bigint, 'an account inside its grace period is not due');
update public.user_account set deletion_requested_at = now() - interval '31 days', deletion_purge_at = now() - interval '1 day'
 where user_id = pg_temp.id('b');
select is((select array_agg(user_id) from kc_private.accounts_due_for_purge()), array[pg_temp.id('b')],
  'an account past its purge date is due');
select throws_ok($$select pg_temp.run('b', 'select public.restore_account()')$$,
  'P0001', 'grace_expired', 'the account cannot be restored after the grace period');
select throws_ok($$select pg_temp.run('a', 'select count(*) from kc_private.accounts_due_for_purge()')$$,
  '42501', null, 'the purge list is not reachable by a member');

-- Any server move out of pending_deletion clears the deletion fields (no check violation).
update public.user_account set status = 'active' where user_id = pg_temp.id('b');
select is((select count(*) from public.user_account where user_id = pg_temp.id('b') and deletion_purge_at is null
    and deletion_requested_at is null and status_before_deletion is null),
  1::bigint, 'leaving pending_deletion by any writer clears the deletion fields');

-- ── account removal ─────────────────────────────────────────────────────────
delete from auth.users where id in (pg_temp.id('a'), pg_temp.id('c'));
select is(
  (select count(*) from public.user_consents where user_id = pg_temp.id('a'))
  + (select count(*) from public.legal_document_versions where published_by is not null),
  0::bigint, 'removing an account removes its consents and detaches the versions it published');

select * from finish();
rollback;
