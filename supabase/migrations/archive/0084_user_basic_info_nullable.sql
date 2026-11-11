-- 0084_user_basic_info_nullable | INFRA-I18N-MIGRATIONS
--
-- Removes the last user-visible Hebrew literals from SQL migrations. After
-- INFRA-I18N-PROD-CODE (✅ Done) pushed all display strings out of TS code,
-- the only remaining source of untranslatable Hebrew was the defaults written
-- by `handle_new_user` (last replaced in 0068) for phone-only OTP signups
-- with no name metadata:
--
--   display_name = coalesce(picked_name, email_local, 'משתמש')
--   city         = '5000'
--   city_name    = 'תל אביב - יפו'
--
-- The right representation of "not yet provided" is NULL. The `pending_basic_info`
-- onboarding state already gates the user behind a flow that fills these fields
-- before they can do anything user-visible; NULL is the legitimate transient
-- value for that window. The mobile UI applies a translated fallback at render
-- time (`t('profile.unnamedUser')` / `t('profile.cityNotSet')`).
--
-- Schema changes:
--   • users.display_name: drop NOT NULL; relax CHECK to permit NULL.
--   • users.city:         drop NOT NULL (FK to cities already allows NULL).
--   • users.city_name:    drop NOT NULL.
--
-- Function changes:
--   • handle_new_user writes NULL for display_name (when no picked_name and no
--     email_local), city, and city_name. All other behaviour from 0068
--     (provider-aware account_status, etc.) is preserved verbatim.
--
-- Backfill:
--   • One-time idempotent UPDATE clears existing rows still carrying the exact
--     Hebrew-default triplet AND still in `pending_basic_info`. The triplet
--     match (`'משתמש'` + city `'5000'` + city_name `'תל אביב - יפו'`) plus the
--     onboarding gate makes false-positives near-impossible: a real user who
--     legitimately chose "משתמש" as their display name would also have moved
--     past `pending_basic_info` by completing onboarding (which overwrites
--     city/city_name).
--
-- Backwards compatibility:
--   • All readers (RPCs, views, FE) tolerate NULL after this migration. The
--     companion FE PR adds null-handling at every render site.

set search_path = public;

-- ── 1. Relax NOT NULL + CHECK constraints ──────────────────────────────
alter table public.users alter column display_name drop not null;
alter table public.users alter column city         drop not null;
alter table public.users alter column city_name    drop not null;

-- Replace the existing length CHECK so it permits NULL.
-- The constraint was defined inline in 0001 without an explicit name; Postgres
-- assigned it the predictable form `users_display_name_check`.
alter table public.users drop constraint if exists users_display_name_check;
alter table public.users add constraint users_display_name_check
  check (display_name is null or char_length(display_name) between 1 and 50);

-- ── 2. handle_new_user — write NULL where no signal exists ─────────────
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

  -- Provider-aware initial account_status (preserved verbatim from 0068).
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
    -- NULL when no name signal in metadata and no email_local. The
    -- `pending_basic_info` onboarding state forces the user to set this
    -- before any user-visible flow proceeds.
    coalesce(picked_name, email_local),
    -- NULL placeholder; onboarding fills `city` (FK to cities) + `city_name`
    -- (denormalised label) together.
    null,
    null,
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

-- ── 3. Backfill: clear rows still on the Hebrew-default triplet ────────
-- Idempotent. Re-running touches zero rows after the first pass.
-- The triple match plus the `pending_basic_info` gate makes false-positives
-- effectively impossible.
update public.users
   set display_name = null,
       city         = null,
       city_name    = null
 where onboarding_state = 'pending_basic_info'
   and display_name = 'משתמש'
   and city         = '5000'
   and city_name    = 'תל אביב - יפו';

-- end of 0084_user_basic_info_nullable
