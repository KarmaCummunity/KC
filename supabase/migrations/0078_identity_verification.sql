-- Identity · ID document + live selfie verification by a provider (FR-VERIFY-004…009, D117)
--
-- A member consents, the server opens a provider session (attempt limits enforced here),
-- and the provider's signed webhook is applied exactly once. KC stores the result only:
-- never images, a document number, a face template or a legal name. The "one person, one
-- account" rule rests on a keyed hash of the document identity that the Edge Function
-- computes (secret `IDV_IDENTITY_HASH_KEY`); the clear document number never reaches the
-- database. Webhook idempotency reuses billing.webhook_events (one row per provider event).
--
-- Service-role entry points: api_identity_verification_begin / _set_session,
-- identity_verification_apply. Member entry points: accept_identity_verification_consent,
-- my_identity_verification. Staff: admin_revoke_identity_verification.
-- Errors (P0001): invalid_input, user_not_found, account_not_active, consent_required,
-- already_verified, manual_review_only, verification_attempts_exhausted, attempt_not_found,
-- session_not_found, invalid_outcome, unknown_event_type.

-- When a provider verification stops counting; null for a manual or never-verified account.
alter table public.user_account add column verification_expires_at timestamptz;
comment on column public.user_account.verification_expires_at is
  'End of a provider identity verification: the earlier of the document expiry and five years after verified_at (FR-VERIFY-009).';

-- ── Consent to biometric processing, per user and text version (FR-VERIFY-004 AC2) ──────
create table public.identity_verification_consents (
  user_id     uuid not null references public.users (id) on delete cascade,
  version     text not null check (char_length(version) between 1 and 40),
  accepted_at timestamptz not null default now(),
  primary key (user_id, version)
);
comment on table public.identity_verification_consents is
  'Explicit consent to biometric processing for identity verification, one row per member and consent text version.';
alter table public.identity_verification_consents enable row level security;
alter table public.identity_verification_consents force row level security;
create policy identity_verification_consents_select_own on public.identity_verification_consents
  for select to authenticated
  using (user_id = auth.uid());
grant select on public.identity_verification_consents to authenticated;

-- ── One row per verification attempt (FR-VERIFY-006 AC1) ────────────────────────────────
create table public.identity_verifications (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users (id) on delete cascade,
  provider            text not null check (provider ~ '^[a-z][a-z0-9_]{0,40}$'),
  -- Set once the provider opened the hosted session; unique per provider.
  provider_session_id text check (char_length(provider_session_id) between 1 and 200),
  -- created: session being opened · in_progress: the member is in the provider flow ·
  -- review: waiting for a person · approved / declined / resubmit: the provider's outcome.
  status              text not null default 'created'
                      check (status in ('created', 'in_progress', 'review', 'approved', 'declined', 'resubmit')),
  decision_reason_code text check (char_length(decision_reason_code) between 1 and 60),
  document_type       text check (document_type in ('il_id_card', 'il_passport', 'foreign_passport')),
  -- ISO 3166-1 alpha-3 issuing country, as identity providers report it (e.g. ISR).
  document_country    text check (document_country ~ '^[A-Z]{3}$'),
  document_expires_on date,
  -- Whether the legal name on the document matches the profile name; the name itself is never stored.
  name_match          boolean,
  created_at          timestamptz not null default now(),
  decided_at          timestamptz,
  unique (provider, provider_session_id)
);
comment on table public.identity_verifications is
  'Identity verification attempts and their outcome. No images, document number, face data or legal name (FR-VERIFY-006).';
-- Attempt-limit counting and the member's latest attempt.
create index identity_verifications_user_idx on public.identity_verifications (user_id, created_at desc);
alter table public.identity_verifications enable row level security;
alter table public.identity_verifications force row level security;
create policy identity_verifications_select_own on public.identity_verifications
  for select to authenticated
  using (user_id = auth.uid());
-- A member reads the status columns of their own attempts only (FR-VERIFY-006 AC7).
grant select (id, status, decision_reason_code, document_type, document_country, created_at, decided_at)
  on public.identity_verifications to authenticated;

-- ── Keyed hashes of verified document identities: one person, one account (AC4) ─────────
create table kc_private.identity_hashes (
  identity_hash text primary key check (identity_hash ~ '^[0-9a-f]{64}$'),
  user_id       uuid not null references public.users (id) on delete cascade,
  created_at    timestamptz not null default now()
);
comment on table kc_private.identity_hashes is
  'HMAC-SHA256 of document country + number, keyed by a function secret; blocks a second account for one identity.';
alter table kc_private.identity_hashes enable row level security;
alter table kc_private.identity_hashes force row level security;

-- ── Member: record consent ──────────────────────────────────────────────────────────────
create function public.accept_identity_verification_consent(p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := auth.uid();
  v_version constant text := nullif(btrim(p_version), '');
begin
  if v_user_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_version is null or char_length(v_version) > 40 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  insert into public.identity_verification_consents (user_id, version) values (v_user_id, v_version)
  on conflict do nothing;
end;
$$;
comment on function public.accept_identity_verification_consent(text) is
  'Member records consent to biometric processing for the given consent text version; repeating it changes nothing.';
grant execute on function public.accept_identity_verification_consent(text) to authenticated;

-- ── Service role: open an attempt (limits and gates, FR-VERIFY-002/005/007) ─────────────
-- Limits: 3 attempts per 24 h and 5 per 30 days; after two forgery / face-mismatch
-- declines only manual review remains. Locks the member so parallel calls cannot bypass them.
create function public.api_identity_verification_begin(p_user_id uuid, p_provider text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.user_account;
  v_level smallint;
  v_attempt_id uuid;
begin
  if p_user_id is null or p_provider is null or p_provider !~ '^[a-z][a-z0-9_]{0,40}$' then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('identity_verification:' || p_user_id::text, 0));
  select a.* into v_account from public.user_account a where a.user_id = p_user_id;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0001';
  end if;
  if v_account.status <> 'active' then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.identity_verification_consents c where c.user_id = p_user_id) then
    raise exception 'consent_required' using errcode = 'P0001';
  end if;
  select u.verification_level into v_level from public.users u where u.id = p_user_id;
  if v_level >= 2 then
    raise exception 'already_verified' using errcode = 'P0001';
  end if;
  if (select count(*) from public.identity_verifications v
       where v.user_id = p_user_id and v.status = 'declined'
         and v.decision_reason_code in ('forgery', 'face_mismatch')) >= 2 then
    raise exception 'manual_review_only' using errcode = 'P0001';
  end if;
  if (select count(*) from public.identity_verifications v
       where v.user_id = p_user_id and v.created_at > now() - interval '24 hours') >= 3
     or (select count(*) from public.identity_verifications v
          where v.user_id = p_user_id and v.created_at > now() - interval '30 days') >= 5 then
    raise exception 'verification_attempts_exhausted' using errcode = 'P0001';
  end if;
  insert into public.identity_verifications (user_id, provider) values (p_user_id, p_provider)
  returning id into v_attempt_id;
  return v_attempt_id;
end;
$$;
comment on function public.api_identity_verification_begin(uuid, text) is
  'Service role: opens a verification attempt after the consent, level and attempt-limit gates; returns its id.';

-- Stores the provider's hosted-session id on a freshly opened attempt.
create function public.api_identity_verification_set_session(p_attempt_id uuid, p_provider_session_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_provider_session_id is null or char_length(p_provider_session_id) not between 1 and 200 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  update public.identity_verifications v
     set provider_session_id = p_provider_session_id, status = 'in_progress'
   where v.id = p_attempt_id and v.status = 'created';
  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0001';
  end if;
end;
$$;
comment on function public.api_identity_verification_set_session(uuid, text) is
  'Service role: attaches the provider session id to a newly opened attempt and marks it in progress.';

-- ── Service role: apply the provider's decision (FR-VERIFY-005 AC4/AC5, FR-VERIFY-006) ──
-- Payload (normalized by the Edge Function): { type: 'identity.decided', provider_session_id,
-- outcome: approved|declined|resubmit|review, reason_code?, document_type?, document_country?,
-- document_expires_on?, date_of_birth?, name_match?, identity_hash? }. An approval is
-- downgraded to a decline for an underage or already-used identity, and to a resubmit for an
-- expired document. A decided attempt is final: a late or repeated event changes nothing.
create function kc_private.identity_verification_decide(p_provider text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.identity_verifications;
  v_outcome text := p_payload ->> 'outcome';
  v_reason text := nullif(p_payload ->> 'reason_code', '');
  v_dob constant date := (p_payload ->> 'date_of_birth')::date;
  v_expires constant date := (p_payload ->> 'document_expires_on')::date;
  v_hash constant text := p_payload ->> 'identity_hash';
  v_previous_dob date;
begin
  if v_outcome is null or v_outcome not in ('approved', 'declined', 'resubmit', 'review') then
    raise exception 'invalid_outcome' using errcode = 'P0001';
  end if;
  select v.* into v_attempt from public.identity_verifications v
   where v.provider = p_provider and v.provider_session_id = p_payload ->> 'provider_session_id' for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;
  if v_attempt.status in ('approved', 'declined') then
    return;
  end if;

  if v_outcome = 'approved' then
    if v_dob is null or v_hash is null then
      raise exception 'invalid_input' using errcode = 'P0001';
    end if;
    if v_dob > (current_date - interval '18 years')::date then
      v_outcome := 'declined';
      v_reason := 'underage';
      -- The minimum-age rule (D109): the account is flagged for staff review.
      perform kc_private.audit_record('identity_underage_flag', 'user', v_attempt.user_id, '{}'::jsonb, null);
    elsif exists (select 1 from kc_private.identity_hashes h
                   where h.identity_hash = v_hash and h.user_id <> v_attempt.user_id) then
      v_outcome := 'declined';
      v_reason := 'identity_already_used';
    elsif v_expires is not null and v_expires <= current_date then
      v_outcome := 'resubmit';
      v_reason := 'document_expired';
    end if;
  end if;

  update public.identity_verifications v
     set status = v_outcome, decision_reason_code = v_reason,
         document_type = p_payload ->> 'document_type', document_country = p_payload ->> 'document_country',
         document_expires_on = v_expires, name_match = (p_payload ->> 'name_match')::boolean,
         decided_at = case when v_outcome in ('approved', 'declined') then now() end
   where v.id = v_attempt.id;
  if v_outcome <> 'approved' then
    return;
  end if;

  insert into kc_private.identity_hashes (identity_hash, user_id) values (v_hash, v_attempt.user_id)
  on conflict do nothing;
  -- Valid until the earlier of the document expiry and five years from now (FR-VERIFY-009 AC1).
  update public.user_account a
     set verified_at = now(), verification_method = 'provider',
         verification_expires_at = least(coalesce(v_expires::timestamptz, 'infinity'::timestamptz), now() + interval '5 years')
   where a.user_id = v_attempt.user_id;
  update public.users u set verification_level = 2 where u.id = v_attempt.user_id and u.verification_level < 2;
  -- The document's date of birth wins over the self-declared one; a change is logged (AC2).
  select p.date_of_birth into v_previous_dob from public.user_private p where p.user_id = v_attempt.user_id;
  if v_previous_dob is distinct from v_dob then
    update public.user_private p set date_of_birth = v_dob where p.user_id = v_attempt.user_id;
    if v_previous_dob is not null then
      perform kc_private.audit_record('date_of_birth_set_by_document', 'user', v_attempt.user_id, '{}'::jsonb, null);
    end if;
  end if;
end;
$$;
comment on function kc_private.identity_verification_decide(text, jsonb) is
  'Applies a provider identity decision to its attempt and, on approval, to the member (level 2, expiry, date of birth).';

-- Stores a provider event and applies it once. Same contract as provider_webhook_apply:
-- a repeat returns the stored outcome; a failed event rolls back and is applied again when resent.
create function public.identity_verification_apply(p_provider_slug text, p_event_id text, p_payload jsonb)
returns table (webhook_event_id uuid, event_status text, event_error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event billing.webhook_events;
  v_type constant text := p_payload ->> 'type';
  v_error text;
begin
  insert into billing.webhook_events (provider_slug, provider_event_id, event_type, payload)
  values (p_provider_slug, p_event_id, v_type, p_payload)
  on conflict (provider_slug, provider_event_id) do nothing
  returning * into v_event;
  if not found then
    select e.* into strict v_event from billing.webhook_events e
     where e.provider_slug = p_provider_slug and e.provider_event_id = p_event_id for update;
    if v_event.status = 'processed' then
      return query select v_event.id, v_event.status, v_event.error_code;
      return;
    end if;
  end if;

  begin
    if v_type is distinct from 'identity.decided' then
      raise exception 'unknown_event_type' using errcode = 'P0001';
    end if;
    perform kc_private.identity_verification_decide(p_provider_slug, p_payload);
  exception when others then
    -- Everything the event did is rolled back; only its failure is recorded.
    v_error := case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;

  update billing.webhook_events e
     set status = case when v_error is null then 'processed' else 'failed' end,
         processed_at = case when v_error is null then now() end,
         error_code = v_error
   where e.id = v_event.id;
  return query select v_event.id, case when v_error is null then 'processed' else 'failed' end, v_error;
end;
$$;
comment on function public.identity_verification_apply(text, text, jsonb) is
  'Service role: stores and applies a provider identity event exactly once; returns the event id with its outcome.';

-- ── Member: own verification status for the status page (FR-VERIFY-003 AC2) ─────────────
-- status: not_started · in_progress · review · verified · declined · resubmit · expired.
create function public.my_identity_verification()
returns table (status text, reason_code text, decided_at timestamptz, verified_at timestamptz, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := auth.uid();
  v_account public.user_account;
  v_level smallint;
  v_attempt public.identity_verifications;
begin
  if v_user_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select a.* into v_account from public.user_account a where a.user_id = v_user_id;
  select u.verification_level into v_level from public.users u where u.id = v_user_id;
  select v.* into v_attempt from public.identity_verifications v
   where v.user_id = v_user_id order by v.created_at desc limit 1;
  return query select
    case
      when v_level >= 2 then 'verified'
      when v_account.verification_expires_at is not null and v_account.verification_expires_at <= now() then 'expired'
      when v_attempt.id is null then 'not_started'
      when v_attempt.status in ('created', 'in_progress') then 'in_progress'
      else v_attempt.status
    end,
    v_attempt.decision_reason_code, v_attempt.decided_at, v_account.verified_at, v_account.verification_expires_at;
end;
$$;
comment on function public.my_identity_verification() is
  'The caller''s identity verification status, latest decision reason and validity dates.';
grant execute on function public.my_identity_verification() to authenticated;

-- ── Expiry: a lapsed provider verification drops the member to level 1 (FR-VERIFY-009 AC2) ─
create function kc_private.identity_verification_expire_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with due as (
    update public.users u set verification_level = 1
      from public.user_account a
     where a.user_id = u.id and u.verification_level = 2 and a.verification_method = 'provider'
       and a.verification_expires_at <= now()
    returning u.id
  )
  select count(*) into v_count from due;
  return v_count;
end;
$$;
comment on function kc_private.identity_verification_expire_due() is
  'Daily sweep: provider-verified members whose verification has lapsed drop to level 1; returns how many.';

insert into kc_private.scheduled_jobs (name, schedule, command, timeout, alert_after, description) values
  ('identity_verification_expire', '20 2 * * *', $$select kc_private.identity_verification_expire_due()$$,
   interval '2 minutes', interval '36 hours', 'Drops members whose provider identity verification has expired to level 1.');

-- ── Staff: revoke a verification for fraud or impersonation (FR-VERIFY-009 AC3) ─────────
-- The identity hash stays, so the same document cannot verify another account.
create function public.admin_revoke_identity_verification(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('admin');
  v_reason constant text := nullif(btrim(p_reason), '');
begin
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  update public.user_account a
     set verified_at = null, verification_method = null, verification_expires_at = null
   where a.user_id = p_user_id;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0001';
  end if;
  update public.users u set verification_level = 1 where u.id = p_user_id and u.verification_level = 2;
  perform kc_private.audit_record('identity_verification_revoked', 'user', p_user_id,
    jsonb_build_object('reason', v_reason), v_actor);
end;
$$;
comment on function public.admin_revoke_identity_verification(uuid, text) is
  'Admin revokes a member''s identity verification with a reason: level drops to 1 at once; audited.';
grant execute on function public.admin_revoke_identity_verification(uuid, text) to authenticated;
