-- 0081_street_number_allow_hebrew_suffix | Closes audit 2026-05-10 §3.1.
--
-- Renumbered from 0080 → 0081 to resolve a parallel-PR collision: PR #195
-- shipped 0080_strip_exif_cron.sql on the same dev iteration as PR #196's
-- 0080_street_number_allow_hebrew_suffix.sql. Both files merged with the same
-- version prefix; `schema_migrations.version` is the PK so only one can ever
-- be recorded. Renaming the later-merged file fixes the duplicate without
-- mutating the strip_exif sequence. (TD-54-class.)
--
-- The original CHECK on `posts.street_number` (migration 0002) and the
-- compound CHECK on `users.profile_street_number` (migration 0043) only
-- accepted a single Latin letter as the optional suffix:
--   street_number ~ '^[0-9]+[A-Za-z]?$'
--
-- Israeli street numbering routinely uses Hebrew letter suffixes (e.g. `12א`,
-- `15ב`). The app is Hebrew-first and forces RTL — rejecting `12א` is an
-- onboarding-and-publish blocker for the target user base.
--
-- Spec: `docs/SSOT/spec/04_posts.md` FR-POST-019 AC3 (updated in the same
-- change-set to spell out that Hebrew suffixes are accepted).
--
-- The Hebrew range `[א-ת]` (U+05D0..U+05EA, 27 codepoints) covers the 22
-- letters plus 5 final forms. Final forms aren't typical address suffixes but
-- allowing them is harmless and keeps the regex simple.
--
-- The `posts.street_number` check on 0002 was inline-defined, so its name is
-- the Postgres auto-generated `posts_street_number_check`. We look it up via
-- pg_constraint to be resilient if the auto-name ever differed, then re-create
-- with a stable name `posts_street_number_format_chk`.

set search_path = public;

-- ── 1. posts.street_number — drop auto-named inline CHECK, add named one ────
do $$
declare
  v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'public.posts'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%street_number ~%';
  if v_name is not null then
    execute format('alter table public.posts drop constraint %I', v_name);
  end if;
end $$;

alter table public.posts
  add constraint posts_street_number_format_chk
  check (street_number ~ '^[0-9]+[A-Za-zא-ת]?$');

-- ── 2. users.profile_street_number — replace compound pair check ────────────
alter table public.users drop constraint if exists users_profile_address_pair_chk;

alter table public.users
  add constraint users_profile_address_pair_chk check (
    (profile_street is null and profile_street_number is null)
    or (
      profile_street is not null
      and profile_street_number is not null
      and char_length(profile_street) between 1 and 80
      and profile_street_number ~ '^[0-9]+[A-Za-zא-ת]?$'
    )
  );

-- end 0081_street_number_allow_hebrew_suffix
