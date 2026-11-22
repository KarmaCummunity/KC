-- Production copy (FR-ADMIN-037) · members.
--
-- The input is already anonymized (AC5–AC7, done in the job's kc-prod step): every member has
-- a keyed id, a fake name, a seed-domain address and cleaned text. Each element of the array:
--   { "id", "email", "display_name", "city_id", "biography", "privacy_mode",
--     "verification_level", "created_at" }

-- Adds new members, updates the ones that exist and deletes copied members that are no longer
-- in the copy (AC8). Returns {members, members_created, members_deleted}.
create or replace function kc_private.prod_copy_sync_members(p_members jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_created integer;
  v_deleted integer;
begin
  -- Dropped first: a test may apply two copies in one transaction.
  if to_regclass('pg_temp.pc_member') is not null then drop table pg_temp.pc_member; end if;
  create temporary table pc_member on commit drop as
  select (m ->> 'id')::uuid as id,
         m ->> 'email' as email,
         left(nullif(btrim(m ->> 'display_name'), ''), 50) as display_name,
         nullif(m ->> 'city_id', '') as city_id,
         nullif(m ->> 'biography', '') as biography,
         coalesce(m ->> 'privacy_mode', 'Public') as privacy_mode,
         coalesce((m ->> 'verification_level')::smallint, 0) as verification_level,
         coalesce((m ->> 'created_at')::timestamptz, now()) as created_at
    from jsonb_array_elements(p_members) m;

  -- AC12: an input row outside the copy's own scope would let the copy write a real account.
  if exists (select 1 from pg_temp.pc_member where email not like 'prodcopy-%@seed.kc.test') then
    raise exception 'prod_copy_bad_member_email' using errcode = 'P0001';
  end if;

  -- A member gone from production goes with everything they own (posts, follows, saves).
  delete from auth.users u
   where u.id = any (kc_private.prod_copy_member_ids())
     and not exists (select 1 from pg_temp.pc_member m where m.id = u.id);
  get diagnostics v_deleted = row_count;

  -- Created the way the auth service creates an account, as the demo members are, so the
  -- baseline trigger builds the member rows. The confirmed address makes the account active;
  -- the empty password and the undeliverable .test address mean nobody can sign in (AC5).
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', m.id, 'authenticated', 'authenticated', m.email, '', now(),
         jsonb_build_object('provider', 'email', 'providers', array['email'], 'seed', true, 'prod_copy', true),
         jsonb_build_object('full_name', m.display_name, 'seed', true, 'prod_copy', true),
         m.created_at, now(), '', '', '', ''
    from pg_temp.pc_member m
   where not exists (select 1 from auth.users u where u.id = m.id);
  get diagnostics v_created = row_count;

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), m.id, m.id::text,
         jsonb_build_object('sub', m.id::text, 'email', m.email, 'email_verified', true),
         'email', null, now(), now()
    from pg_temp.pc_member m
   where not exists (select 1 from auth.identities i where i.user_id = m.id and i.provider = 'email');

  -- Only rows that differ are written, so a weekly run over unchanged members writes nothing.
  update public.users p
     set display_name = m.display_name, city_id = m.city_id, biography = m.biography,
         privacy_mode = m.privacy_mode, verification_level = m.verification_level,
         preferred_language = 'he'
    from pg_temp.pc_member m
   where p.id = m.id
     and (p.display_name, p.city_id, p.biography, p.privacy_mode, p.verification_level, p.preferred_language)
         is distinct from (m.display_name, m.city_id, m.biography, m.privacy_mode, m.verification_level, 'he');

  update public.user_account a
     set onboarding_state = 'completed'
    from pg_temp.pc_member m
   where a.user_id = m.id and a.onboarding_state <> 'completed';

  -- Every copied member accepted the legal documents in force, like any member who finished
  -- onboarding. World declarations are added by the posts phase, only for the owners of the
  -- posts that need them.
  insert into public.user_consents (user_id, consent_kind, version, locale)
  select m.id, d.doc_type, d.current_version, 'he'
    from pg_temp.pc_member m
   cross join public.legal_documents d
   where d.current_version > 0
  on conflict (user_id, consent_kind, version) do nothing;

  return jsonb_build_object('members', (select count(*) from pg_temp.pc_member),
                            'members_created', v_created, 'members_deleted', v_deleted);
end;
$$;
comment on function kc_private.prod_copy_sync_members(jsonb) is
  'FR-ADMIN-037: adds, updates and removes copied members from the anonymized copy.';
