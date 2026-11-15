-- E2E test members for kc-dev: user1 … user4 @seed.kc.test (tests/e2e). DEV ONLY.
--
-- The nightly browser suite signs in as user1 and user2 and blocks user3; user4 is the spare
-- for the opt-in account-deletion journey. They are ordinary members created the way the auth
-- service creates them: an `auth.users` row plus its email identity; the baseline trigger
-- builds the member rows and the confirmed email makes the account active. No posts, follows
-- or chats are created: the suite makes its own rows (`[e2e <timestamp>] …`).
--
-- Session settings the caller must set first (the Seed KC dev workflow does):
--   kc.seed_target   = 'dev'
--   kc.seed_password = the E2E_SEED_PASSWORD secret (hashed here, never stored in the repo)
-- Safe to run again: existing members keep their rows; only the password hash is refreshed.
begin;

do $$
begin
  if coalesce(current_setting('kc.seed_target', true), '') <> 'dev' then
    raise exception 'refusing to seed: set kc.seed_target=dev';
  end if;
  if coalesce(current_setting('kc.seed_password', true), '') = '' then
    raise exception 'refusing to seed: set kc.seed_password (the E2E_SEED_PASSWORD secret)';
  end if;
end $$;

create temp table e2e_member on commit drop as
select n, 'user' || n || '@seed.kc.test' as email, 'E2E Member ' || n as full_name
from generate_series(1, 4) n;

-- New members. The password is bcrypt-hashed with the extensions the platform provides.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       m.email, extensions.crypt(current_setting('kc.seed_password'), extensions.gen_salt('bf')), now(),
       jsonb_build_object('provider', 'email', 'providers', array['email'], 'seed', true),
       jsonb_build_object('full_name', m.full_name, 'seed', true),
       now(), now(), '', '', '', ''
  from e2e_member m
 where not exists (select 1 from auth.users u where u.email = m.email);

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
  from auth.users u
  join e2e_member m on m.email = u.email
 where not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

-- A known password on every run, so a rotated secret takes effect.
update auth.users u
   set encrypted_password = extensions.crypt(current_setting('kc.seed_password'), extensions.gen_salt('bf'))
  from e2e_member m
 where u.email = m.email;

-- Complete the profile and onboarding like the app does (basic info, then completed).
update public.users p
   set display_name = m.full_name,
       city_id = (select c.city_id from public.cities c where c.name_en = 'NETANYA' limit 1),
       preferred_language = 'he'
  from e2e_member m
  join auth.users u on u.email = m.email
 where p.id = u.id;

update public.user_private pr
   set date_of_birth = date '1990-01-01'
  from e2e_member m
  join auth.users u on u.email = m.email
 where pr.user_id = u.id
   and pr.date_of_birth is null;

update public.user_account a
   set onboarding_state = 'completed'
  from e2e_member m
  join auth.users u on u.email = m.email
 where a.user_id = u.id
   and a.onboarding_state <> 'completed';

select 'e2e members' as what, count(*) as n
  from auth.users u join e2e_member m on m.email = u.email;

commit;
