-- Identity · users (public profile)
--
-- One row per member, holding only what other members may see. Private fields, account state
-- and counters live in their own 1:1 tables (user_private, user_account, user_stats), so a
-- row another member can select never contains anything private.

create table public.users (
  -- Same id as the auth account; removing the auth account removes the member.
  id                 uuid primary key references auth.users (id) on delete cascade,
  -- Public, shareable identifier used in profile links.
  share_handle       text not null unique check (share_handle ~ '^[a-z0-9_]{3,30}$'),
  -- Empty until the member completes the first onboarding step.
  display_name       text check (char_length(display_name) between 1 and 50),
  -- Free text; links are rejected so the profile cannot be used for advertising.
  biography          text check (
                       char_length(biography) <= 200
                       and biography !~* '(https?://|www\.|[\w.-]+\.[a-z]{2,})'),
  avatar_url         text,
  city_id            text references public.cities (city_id),
  -- 'Private' hides the member's posts and follower lists from non-followers.
  privacy_mode       text not null default 'Public' check (privacy_mode in ('Public', 'Private')),
  privacy_changed_at timestamptz,
  -- 0 none · 1 phone · 2 identity document · 3 verified badge.
  verification_level smallint not null default 0 check (verification_level between 0 and 3),
  -- BCP 47 tag of the member's interface language.
  preferred_language text check (char_length(preferred_language) between 2 and 35),
  -- Mirror of user_account.status = 'active', maintained by trigger. Kept on this row so the
  -- visibility policy is a plain column test rather than a join on every profile read.
  is_active          boolean not null default false,
  -- Search document over name and handle; `simple` keeps Hebrew tokens unstemmed.
  search_vector      tsvector generated always as (
                       to_tsvector('simple', coalesce(display_name, '') || ' ' || share_handle)) stored,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.users is 'Public profile of a member. Contains nothing private.';

-- Member search: whole-word match, then substring match on the display name.
create index users_search_gin_idx on public.users using gin (search_vector) where is_active;
create index users_display_name_trgm_idx on public.users
  using gin (display_name extensions.gin_trgm_ops) where is_active;
-- City filter in member search and city statistics.
create index users_city_idx on public.users (city_id) where is_active;

create trigger users_set_updated_at
  before update on public.users
  for each row execute function kc_private.set_updated_at();

alter table public.users enable row level security;
alter table public.users force row level security;

-- A member sees active profiles, and always their own (whatever its account state).
create policy users_select_active_or_self on public.users
  for select to authenticated
  using (is_active or id = (select auth.uid()));

-- A member edits their own profile; which columns is decided by the grant below.
create policy users_update_self on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

grant select on public.users to authenticated;
-- Handle, privacy mode, verification level and is_active change only through server code.
grant update (display_name, biography, avatar_url, city_id, preferred_language)
  on public.users to authenticated;
