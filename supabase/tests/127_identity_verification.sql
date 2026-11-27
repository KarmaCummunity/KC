-- Identity verification (FR-VERIFY-004…009): consent, attempt gates and limits, the provider
-- decision applied exactly once, one person one account, underage / expired documents,
-- expiry, staff revoke, and who may read or call what.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs one statement as an API role (and member a..e, or none) and returns its single value,
-- or the error text for a business error (P0001) / permission error (42501).
create function pg_temp.act(p_role text, p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', p_role)::text, true);
    perform set_config('role', p_role, true);
    execute p_sql into v_value;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return coalesce(v_value, 'null');
  exception when others then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return case when sqlstate in ('P0001', '42501') then sqlerrm else sqlstate end;
  end;
end;
$$;

-- A decision event for a provider session; `p_extra` adds or overrides payload keys.
create function pg_temp.decided(p_session text, p_outcome text, p_extra jsonb default '{}')
returns jsonb
language sql
as $$
  select jsonb_build_object('type', 'identity.decided', 'provider_session_id', p_session, 'outcome', p_outcome,
    'document_type', 'il_id_card', 'document_country', 'ISR', 'document_expires_on', '2099-01-01',
    'date_of_birth', '1990-05-05', 'name_match', true, 'identity_hash', repeat('a', 64)) || p_extra
$$;

-- Applies an event as the service role and returns "status/error".
create function pg_temp.apply(p_event text, p_payload jsonb)
returns text
language sql
as $$
  select pg_temp.act('service_role', 'a',
    format($q$select event_status || '/' || coalesce(event_error_code, '') from public.identity_verification_apply('didit', %L, %L::jsonb)$q$, p_event, p_payload::text))
$$;

-- Opens an attempt as the service role and attaches its provider session; returns the begin result.
create function pg_temp.open(p_member text, p_session text)
returns text
language plpgsql
as $$
declare
  v_attempt text;
begin
  v_attempt := pg_temp.act('service_role', 'a',
    format($q$select public.api_identity_verification_begin('00000000-0000-4000-8000-00000000000%s', 'didit')::text$q$, p_member));
  if v_attempt ~ '^[0-9a-f-]{36}$' then
    perform pg_temp.act('service_role', 'a',
      format($q$select public.api_identity_verification_set_session(%L::uuid, %L)::text || 'ok'$q$, v_attempt, p_session));
  end if;
  return v_attempt;
end;
$$;

select plan(38);

-- a, b, c, e are members; d is an admin.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd', 'e']) x;
insert into public.admin_role_grants (user_id, role) values ('00000000-0000-4000-8000-00000000000d', 'admin');

-- ── Consent ─────────────────────────────────────────────────────────────────────────────
select is(pg_temp.act('authenticated', 'a', $$select public.accept_identity_verification_consent('v1')::text || 'ok'$$),
  'ok', 'a member records consent');
select is(pg_temp.act('authenticated', 'a', $$select public.accept_identity_verification_consent('v1')::text || 'ok'$$)
    || '|' || (select count(*) from public.identity_verification_consents where user_id = '00000000-0000-4000-8000-00000000000a'),
  'ok|1', 'repeating the same version changes nothing');
select is(pg_temp.act('anon', 'a', $$select public.accept_identity_verification_consent('v1')::text$$),
  'permission denied for function accept_identity_verification_consent', 'signed out, no consent');

-- ── Opening an attempt ──────────────────────────────────────────────────────────────────
select is(pg_temp.act('service_role', 'a', $$select public.api_identity_verification_begin('00000000-0000-4000-8000-00000000000b', 'didit')::text$$),
  'consent_required', 'no attempt without consent');
select is(pg_temp.act('authenticated', 'a', $$select public.api_identity_verification_begin('00000000-0000-4000-8000-00000000000a', 'didit')::text$$),
  'permission denied for function api_identity_verification_begin', 'a member cannot open a session themselves');
create temp table attempt (member text primary key, id text);
create temp table outcome (step text primary key, result text);
insert into attempt values ('a', pg_temp.open('a', 'sess-a1'));
select ok((select id from attempt where member = 'a') ~ '^[0-9a-f-]{36}$', 'with consent the attempt opens');
select is((select status from public.identity_verifications where id = (select id from attempt where member = 'a')::uuid),
  'in_progress', 'the provider session id moves it to in progress');

-- ── Approval: level 2, expiry, date of birth ────────────────────────────────────────────
select is(pg_temp.apply('e1', pg_temp.decided('sess-a1', 'approved')), 'processed/', 'an approval is applied');
select is((select verification_level from public.users where id = '00000000-0000-4000-8000-00000000000a'),
  2::smallint, '… the member is level 2');
select is((select verification_method from public.user_account where user_id = '00000000-0000-4000-8000-00000000000a'),
  'provider', '… verified by the provider');
select ok((select verification_expires_at between now() + interval '4 years' and now() + interval '5 years 1 day'
             from public.user_account where user_id = '00000000-0000-4000-8000-00000000000a'),
  '… valid for at most five years when the document outlives that');
select is((select date_of_birth::text from public.user_private where user_id = '00000000-0000-4000-8000-00000000000a'),
  '1990-05-05', '… the document''s date of birth is stored privately');
select is(pg_temp.apply('e1', pg_temp.decided('sess-a1', 'approved')) || '|'
    || (select count(*) from billing.webhook_events where provider_slug = 'didit' and provider_event_id = 'e1'),
  'processed/|1', 'the same event again is stored once and changes nothing');
select is(pg_temp.apply('e2', pg_temp.decided('sess-a1', 'declined', '{"reason_code":"forgery"}')) || '|'
    || (select status from public.identity_verifications where provider_session_id = 'sess-a1'),
  'processed/|approved', 'a decided attempt is final: a later event does not change it');
select is(pg_temp.act('service_role', 'a', $$select public.api_identity_verification_begin('00000000-0000-4000-8000-00000000000a', 'didit')::text$$),
  'already_verified', 'a verified member cannot start again');
select is(pg_temp.act('authenticated', 'a', $$select status from public.my_identity_verification()$$),
  'verified', 'the status page says verified');
select is(pg_temp.act('authenticated', 'b', $$select status from public.my_identity_verification()$$),
  'not_started', 'another member has not started');

-- ── One person, one account ─────────────────────────────────────────────────────────────
select is(pg_temp.act('authenticated', 'b', $$select public.accept_identity_verification_consent('v1')::text || 'ok'$$), 'ok', 'b consents');
insert into attempt values ('b', pg_temp.open('b', 'sess-b1'));
insert into outcome values ('e3', pg_temp.apply('e3', pg_temp.decided('sess-b1', 'approved')));
select is((select result from outcome where step = 'e3') || '|'
    || (select decision_reason_code || ':' || status from public.identity_verifications where provider_session_id = 'sess-b1'),
  'processed/|identity_already_used:declined', 'the same document on a second account is declined');
select is((select verification_level from public.users where id = '00000000-0000-4000-8000-00000000000b'),
  0::smallint, '… and the second account stays unverified');

-- ── Underage, expired document, unknown session / event ─────────────────────────────────
select is(pg_temp.act('authenticated', 'c', $$select public.accept_identity_verification_consent('v1')::text || 'ok'$$), 'ok', 'c consents');
insert into attempt values ('c', pg_temp.open('c', 'sess-c1'));
insert into outcome values ('e4', pg_temp.apply('e4', pg_temp.decided('sess-c1', 'approved',
      jsonb_build_object('identity_hash', repeat('c', 64), 'date_of_birth', (current_date - interval '10 years')::date))));
select is((select result from outcome where step = 'e4')
    || '|' || (select decision_reason_code || ':' || status from public.identity_verifications where provider_session_id = 'sess-c1'),
  'processed/|underage:declined', 'a document of a minor is declined');
select ok(exists (select 1 from audit.events where action = 'identity_underage_flag'
                   and target_id = '00000000-0000-4000-8000-00000000000c'), '… and the account is flagged for review');
select ok(pg_temp.open('c', 'sess-c2') ~ '^[0-9a-f-]{36}$', 'the member may try again with another capture');
insert into outcome values ('e5', pg_temp.apply('e5', pg_temp.decided('sess-c2', 'approved',
      jsonb_build_object('identity_hash', repeat('d', 64), 'document_expires_on', '2020-01-01'))));
select is((select result from outcome where step = 'e5')
    || '|' || (select decision_reason_code || ':' || status from public.identity_verifications where provider_session_id = 'sess-c2'),
  'processed/|document_expired:resubmit', 'an expired document asks for a new capture');
select is(pg_temp.apply('e6', pg_temp.decided('no-such-session', 'approved')), 'failed/session_not_found',
  'an event for an unknown session fails and can be resent');
select is(pg_temp.apply('e7', '{"type":"something.else"}'), 'failed/unknown_event_type', 'an unknown event type fails');

-- ── Attempt limits and manual-review fallback ───────────────────────────────────────────
select ok(pg_temp.open('c', 'sess-c3') ~ '^[0-9a-f-]{36}$', 'a third attempt in 24 hours is allowed');
select is(pg_temp.act('service_role', 'a', $$select public.api_identity_verification_begin('00000000-0000-4000-8000-00000000000c', 'didit')::text$$),
  'verification_attempts_exhausted', 'the fourth attempt in 24 hours is refused');
select is(pg_temp.act('authenticated', 'e', $$select public.accept_identity_verification_consent('v1')::text || 'ok'$$), 'ok', 'e consents');
insert into public.identity_verifications (user_id, provider, status, decision_reason_code) values
  ('00000000-0000-4000-8000-00000000000e', 'didit', 'declined', 'forgery'),
  ('00000000-0000-4000-8000-00000000000e', 'didit', 'declined', 'face_mismatch');
select is(pg_temp.act('service_role', 'a', $$select public.api_identity_verification_begin('00000000-0000-4000-8000-00000000000e', 'didit')::text$$),
  'manual_review_only', 'after two forgery or mismatch declines only manual review remains');

-- ── Who reads what ──────────────────────────────────────────────────────────────────────
select is(pg_temp.act('authenticated', 'b',
    format($q$select count(*)::text from public.identity_verifications where id = %L$q$, (select id from attempt where member = 'a'))),
  '0', 'a member does not see another member''s attempts');
select is(pg_temp.act('authenticated', 'a', $$select document_expires_on::text from public.identity_verifications$$),
  'permission denied for table identity_verifications', 'a member reads status columns only');
select is(pg_temp.act('authenticated', 'a', $$select event_status from public.identity_verification_apply('didit', 'x', '{}'::jsonb)$$),
  'permission denied for function identity_verification_apply', 'a client cannot apply provider events');

-- ── Expiry and revoke ───────────────────────────────────────────────────────────────────
update public.user_account set verification_expires_at = now() - interval '1 day'
 where user_id = '00000000-0000-4000-8000-00000000000a';
select is(kc_private.identity_verification_expire_due(), 1, 'the sweep drops one lapsed member');
select is((select verification_level from public.users where id = '00000000-0000-4000-8000-00000000000a') || '|'
    || pg_temp.act('authenticated', 'a', $$select status from public.my_identity_verification()$$),
  '1|expired', '… to level 1, and the status page says expired');
update public.users set verification_level = 2 where id = '00000000-0000-4000-8000-00000000000a';
select is(pg_temp.act('authenticated', 'b', $$select public.admin_revoke_identity_verification('00000000-0000-4000-8000-00000000000a', 'fraud')::text$$),
  'forbidden', 'a member cannot revoke');
insert into outcome values ('revoke', pg_temp.act('authenticated', 'd', $$select public.admin_revoke_identity_verification('00000000-0000-4000-8000-00000000000a', 'fraud')::text || 'ok'$$));
select is((select result from outcome where step = 'revoke')
    || '|' || (select verification_level::text from public.users where id = '00000000-0000-4000-8000-00000000000a')
    || '|' || exists (select 1 from audit.events where action = 'identity_verification_revoked'),
  'ok|1|true', 'an admin revokes: level 1 at once, audited');

select * from finish();
rollback;
