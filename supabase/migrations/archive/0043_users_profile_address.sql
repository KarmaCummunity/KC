-- 0043_users_profile_address — FR-PROFILE-007: optional profile street + number (after main's 0034..0042 chain).
-- Idempotent: safe if columns already exist (e.g. manual hotfix). Pairing mirrors post address checks when set.

alter table public.users
  add column if not exists profile_street text,
  add column if not exists profile_street_number text;

comment on column public.users.profile_street is
  'Optional profile street (1–80 chars when set). Null with null number = city-only.';
comment on column public.users.profile_street_number is
  'Optional building number when profile_street is set; same regex as posts.street_number.';

alter table public.users drop constraint if exists users_profile_address_pair_chk;

alter table public.users
  add constraint users_profile_address_pair_chk check (
    (profile_street is null and profile_street_number is null)
    or (
      profile_street is not null
      and profile_street_number is not null
      and char_length(profile_street) between 1 and 80
      and profile_street_number ~ '^[0-9]+[A-Za-z]?$'
    )
  );
