-- 0068 — Verification-status correctness: provider-aware INSERT + verified
-- trigger that watches both confirmation columns.
--
-- Why this exists
--   D-20 / migration 0067 assumed that Google / Apple / phone users land
--   as `active` on first INSERT because the provider returns
--   `email_confirmed_at` immediately. That assumption holds for Google but
--   is wrong for two real paths:
--     1. Phone-only OTP: `auth.users.email_confirmed_at` is NEVER set —
--        the verified flag lives on `phone_confirmed_at`. handle_new_user
--        (0008) only checked `email_confirmed_at`, so phone users were
--        written as `pending_verification` at INSERT time, and the
--        `on_auth_user_email_confirmed` trigger (0067) only fires on UPDATE
--        OF email_confirmed_at, so the OTP UPDATE on `phone_confirmed_at`
--        never promoted them. Result: phone users were permanently stuck
--        and the gate signed them out on every sign-in.
--     2. Google / Apple: in practice `auth.users` is INSERTed with
--        email_confirmed_at = NULL and then UPDATEd ~85ms later. The 0067
--        UPDATE-trigger does flip them, but a transient
--        `pending_verification` window exists — fragile if any future
--        change moved the gate check earlier.
--
-- After this migration
--   • handle_new_user picks initial account_status from the provider:
--       google / apple                                       → 'active'
--       phone, phone_confirmed_at IS NOT NULL                → 'active'
--       email, email_confirmed_at IS NOT NULL                → 'active'
--       otherwise                                            → 'pending_verification'
--     Google / Apple no longer transit through `pending_verification`.
--   • The verified trigger watches BOTH email_confirmed_at AND
--     phone_confirmed_at and is renamed `on_auth_user_verified`. It
--     flips pending_verification → active when either column goes from
--     NULL → timestamp.
--   • One-time backfill clears any row currently stuck in
--     `pending_verification` whose auth.users counterpart already has
--     either confirmation timestamp set.
--   • auth_check_account_gate behavior is unchanged from 0067 (denies
--     pending_verification). Defense in depth still active.

-- ── 1. handle_new_user — provider-aware initial status ─────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta            jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  app_meta        jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  picked_name     text;
  picked_avatar   text;
  picked_provider text;
  email_local     text;
  default_handle  text;
  v_status        text;
begin
  picked_name := nullif(coalesce(meta->>'full_name', meta->>'name'), '');
  picked_avatar := nullif(coalesce(meta->>'avatar_url', meta->>'picture'), '');
  picked_provider := coalesce(app_meta->>'provider', 'email');
  if picked_provider not in ('google','apple','phone','email') then
    picked_provider := 'email';
  end if;
  email_local := nullif(split_part(coalesce(new.email, ''), '@', 1), '');

  default_handle := 'u_' || substr(replace(new.id::text, '-', ''), 1, 10);

  if picked_provider in ('google','apple') then
    v_status := 'active';
  elsif picked_provider = 'phone' and new.phone_confirmed_at is not null then
    v_status := 'active';
  elsif picked_provider = 'email' and new.email_confirmed_at is not null then
    v_status := 'active';
  else
    v_status := 'pending_verification';
  end if;

  insert into public.users (
    user_id, auth_provider, share_handle, display_name,
    city, city_name, avatar_url, account_status, onboarding_state
  ) values (
    new.id,
    picked_provider,
    default_handle,
    coalesce(picked_name, email_local, 'משתמש'),
    '5000',
    'תל אביב - יפו',
    picked_avatar,
    v_status,
    'pending_basic_info'
  );

  insert into public.auth_identities (user_id, provider, provider_subject)
  values (new.id, picked_provider, new.id::text)
  on conflict (provider, provider_subject) do nothing;

  return new;
end;
$$;

-- INSERT trigger definition unchanged (0001); keep it bound to handle_new_user.

-- ── 2. handle_user_verified — fires on any verification column flip ───
create or replace function public.handle_user_verified()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.email_confirmed_at is not null and old.email_confirmed_at is null)
     or (new.phone_confirmed_at is not null and old.phone_confirmed_at is null) then
    update public.users
       set account_status = 'active'
     where user_id = new.id
       and account_status = 'pending_verification';
  end if;
  return new;
end;
$$;

-- Drop the previous (email-only) trigger from 0067 and the legacy function.
drop trigger if exists on_auth_user_email_confirmed on auth.users;
drop function if exists public.handle_email_confirmed();

drop trigger if exists on_auth_user_verified on auth.users;
create trigger on_auth_user_verified
  after update of email_confirmed_at, phone_confirmed_at on auth.users
  for each row
  execute function public.handle_user_verified();

-- ── 3. Backfill: clear rows already verified at auth-layer ─────────────
-- Idempotent: re-running the migration touches zero rows after the first pass.
update public.users u
   set account_status = 'active'
  from auth.users au
 where u.user_id = au.id
   and u.account_status = 'pending_verification'
   and (au.email_confirmed_at is not null or au.phone_confirmed_at is not null);
