-- 0096_contact_phone — FR-PROFILE-007 (extension): optional, non-verified contact phone on users.
-- Distinct from `auth.users.phone` (OTP identifier). Free-form text the user types into onboarding
-- / Edit Profile and is rendered as a tappable `tel:` link on the chat anchored-post card.
-- Idempotent — safe if column already exists (manual hotfix).

alter table public.users
  add column if not exists contact_phone text;

comment on column public.users.contact_phone is
  'Optional contact phone for display in profile + chat banner. Free-form, non-verified. Distinct from auth.users.phone (OTP identifier). Null = unset.';

alter table public.users drop constraint if exists users_contact_phone_chk;

alter table public.users
  add constraint users_contact_phone_chk check (
    contact_phone is null
    or (char_length(btrim(contact_phone)) between 1 and 20)
  );
