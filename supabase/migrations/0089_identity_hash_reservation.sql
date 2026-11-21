-- Forward-only identity reservation correction. Existing frozen migrations remain unchanged.
create or replace function kc_private.identity_verification_decide(p_provider text, p_payload jsonb)
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
  v_hash_owner uuid;
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

  -- The unique hash insert can wait for another account's transaction. Re-read
  -- ownership after that wait before approving, including parallel provider approvals for different accounts.
  if v_outcome = 'approved' then
    insert into kc_private.identity_hashes (identity_hash, user_id) values (v_hash, v_attempt.user_id)
      on conflict do nothing;
    select h.user_id into v_hash_owner from kc_private.identity_hashes h
      where h.identity_hash = v_hash for update;
    if v_hash_owner is distinct from v_attempt.user_id then
      v_outcome := 'declined';
      v_reason := 'identity_already_used';
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
