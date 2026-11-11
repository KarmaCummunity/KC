-- 0001_init_users | P0.2.a — Foundation & Identity
-- FR-AUTH-003, FR-AUTH-006, FR-AUTH-010..012, FR-PROFILE-001..007, FR-PROFILE-013, FR-AUTH-016 (status enum only)

-- ── Extensions ───────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ── 1. cities (reference table) ──────────────────────────────────────────────
create table if not exists public.cities (
  city_id  text primary key,
  name_he  text not null,
  name_en  text not null
);

alter table public.cities enable row level security;

-- Public read; writes only via migrations / service-role.
create policy cities_select_all on public.cities
  for select using (true);

-- Seed Israeli cities here (rather than seed.sql) so prod (`supabase db push`)
-- gets the reference data atomically with the migration. seed.sql is only
-- applied on local `db reset`.
insert into public.cities (city_id, name_he, name_en) values
  ('tel-aviv',     'תל אביב',          'Tel Aviv'),
  ('jerusalem',    'ירושלים',           'Jerusalem'),
  ('haifa',        'חיפה',              'Haifa'),
  ('rishon',       'ראשון לציון',       'Rishon LeZion'),
  ('petah-tikva',  'פתח תקווה',         'Petah Tikva'),
  ('ashdod',       'אשדוד',             'Ashdod'),
  ('netanya',      'נתניה',             'Netanya'),
  ('beer-sheva',   'באר שבע',           'Beer Sheva'),
  ('bnei-brak',    'בני ברק',           'Bnei Brak'),
  ('holon',        'חולון',             'Holon'),
  ('ramat-gan',    'רמת גן',            'Ramat Gan'),
  ('ashkelon',     'אשקלון',            'Ashkelon'),
  ('rehovot',      'רחובות',            'Rehovot'),
  ('bat-yam',      'בת ים',             'Bat Yam'),
  ('herzliya',     'הרצליה',            'Herzliya'),
  ('kfar-saba',    'כפר סבא',           'Kfar Saba'),
  ('hadera',       'חדרה',              'Hadera'),
  ('modiin',       'מודיעין',           'Modi''in'),
  ('nazareth',     'נצרת',              'Nazareth'),
  ('raanana',      'רעננה',             'Ra''anana')
on conflict (city_id) do nothing;

-- ── 2. users ────────────────────────────────────────────────────────────────
create table if not exists public.users (
  user_id                       uuid primary key references auth.users(id) on delete cascade,
  auth_provider                 text not null
    check (auth_provider in ('google','apple','phone','email')),
  share_handle                  text not null unique,
  display_name                  text not null
    check (char_length(display_name) between 1 and 50),
  city                          text not null references public.cities(city_id),
  city_name                     text not null,
  biography                     text
    check (biography is null or char_length(biography) <= 200),
  avatar_url                    text,
  privacy_mode                  text not null default 'Public'
    check (privacy_mode in ('Public','Private')),
  privacy_changed_at            timestamptz,
  account_status                text not null default 'pending_verification'
    check (account_status in (
      'pending_verification','active','suspended_for_false_reports',
      'suspended_admin','banned','deleted'
    )),
  onboarding_state              text not null default 'pending_basic_info'
    check (onboarding_state in ('pending_basic_info','pending_avatar','completed')),
  notification_preferences      jsonb not null default jsonb_build_object('critical', true, 'social', true),
  is_super_admin                boolean not null default false,
  closure_explainer_dismissed   boolean not null default false,
  first_post_nudge_dismissed    boolean not null default false,
  -- Counters (denormalised; maintained by triggers in P0.2.f)
  items_given_count             integer not null default 0,
  items_received_count          integer not null default 0,
  active_posts_count_internal   integer not null default 0,
  followers_count               integer not null default 0,
  following_count               integer not null default 0,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index users_account_status_idx on public.users (account_status);
create index users_privacy_mode_idx   on public.users (privacy_mode);
create index users_city_idx           on public.users (city);

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- ── 3. auth_identities ──────────────────────────────────────────────────────
create table if not exists public.auth_identities (
  auth_identity_id  uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(user_id) on delete cascade,
  provider          text not null
    check (provider in ('google','apple','phone','email')),
  provider_subject  text not null,
  created_at        timestamptz not null default now(),
  unique (provider, provider_subject)
);

create index auth_identities_user_id_idx on public.auth_identities (user_id);

-- ── 4. devices ──────────────────────────────────────────────────────────────
create table if not exists public.devices (
  device_id     uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(user_id) on delete cascade,
  platform      text not null check (platform in ('ios','android','web')),
  push_token    text not null unique,
  last_seen_at  timestamptz not null default now(),
  active        boolean not null default true
);

create index devices_user_id_idx on public.devices (user_id);

-- ── 5. handle_new_user — bridge auth.users → public.users ──────────────────
-- Runs as SECURITY DEFINER so it can write to public.users from the auth schema's trigger context.
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
begin
  picked_name := nullif(coalesce(meta->>'full_name', meta->>'name'), '');
  picked_avatar := nullif(coalesce(meta->>'avatar_url', meta->>'picture'), '');
  picked_provider := coalesce(app_meta->>'provider', 'email');
  if picked_provider not in ('google','apple','phone','email') then
    picked_provider := 'email';
  end if;
  email_local := nullif(split_part(coalesce(new.email, ''), '@', 1), '');

  default_handle := 'u_' || substr(replace(new.id::text, '-', ''), 1, 10);

  insert into public.users (
    user_id, auth_provider, share_handle, display_name,
    city, city_name, avatar_url, account_status, onboarding_state
  ) values (
    new.id,
    picked_provider,
    default_handle,
    coalesce(picked_name, email_local, 'משתמש'),
    'tel-aviv',
    'תל אביב',
    picked_avatar,
    case when new.email_confirmed_at is not null then 'active' else 'pending_verification' end,
    'pending_basic_info'
  );

  insert into public.auth_identities (user_id, provider, provider_subject)
  values (new.id, picked_provider, new.id::text)
  on conflict (provider, provider_subject) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 5.b Backfill: existing auth.users rows that pre-date this migration ────
-- One-time, idempotent (`on conflict do nothing`). Required because anyone who
-- signed in before this migration ran has an `auth.users` row but no matching
-- `public.users` row, and the trigger only fires for *new* INSERTs.
do $$
declare
  rec record;
  meta jsonb;
  app_meta jsonb;
  picked_name text;
  picked_avatar text;
  picked_provider text;
  email_local text;
  default_handle text;
begin
  for rec in
    select id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data
    from auth.users
    where id not in (select user_id from public.users)
  loop
    meta := coalesce(rec.raw_user_meta_data, '{}'::jsonb);
    app_meta := coalesce(rec.raw_app_meta_data, '{}'::jsonb);
    picked_name := nullif(coalesce(meta->>'full_name', meta->>'name'), '');
    picked_avatar := nullif(coalesce(meta->>'avatar_url', meta->>'picture'), '');
    picked_provider := coalesce(app_meta->>'provider', 'email');
    if picked_provider not in ('google','apple','phone','email') then
      picked_provider := 'email';
    end if;
    email_local := nullif(split_part(coalesce(rec.email, ''), '@', 1), '');
    default_handle := 'u_' || substr(replace(rec.id::text, '-', ''), 1, 10);

    insert into public.users (
      user_id, auth_provider, share_handle, display_name,
      city, city_name, avatar_url, account_status, onboarding_state
    ) values (
      rec.id,
      picked_provider,
      default_handle,
      coalesce(picked_name, email_local, 'משתמש'),
      'tel-aviv',
      'תל אביב',
      picked_avatar,
      case when rec.email_confirmed_at is not null then 'active' else 'pending_verification' end,
      'pending_basic_info'
    )
    on conflict (user_id) do nothing;

    insert into public.auth_identities (user_id, provider, provider_subject)
    values (rec.id, picked_provider, rec.id::text)
    on conflict (provider, provider_subject) do nothing;
  end loop;
end $$;

-- ── 6. RLS policies ────────────────────────────────────────────────────────
alter table public.users           enable row level security;
alter table public.auth_identities enable row level security;
alter table public.devices         enable row level security;

-- 6.1 users: SELECT — anyone reads public+active rows; owner reads own row regardless.
--     (Approved-follower visibility for Private mode is added in P0.2.c.)
create policy users_select_public on public.users
  for select
  using (
    privacy_mode = 'Public'
    and account_status = 'active'
  );

create policy users_select_self on public.users
  for select
  using (auth.uid() = user_id);

-- 6.2 users: UPDATE — only own row. Sensitive columns are guarded by a check.
--     The check enforces that immutable fields keep their pre-update value.
create policy users_update_self on public.users
  for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
  );

-- 6.3 users: INSERT — blocked from clients. The handle_new_user() trigger
--     (SECURITY DEFINER) is the only writer. No INSERT policy is created.

-- 6.4 users: DELETE — blocked at the policy layer. Account deletion is a
--     status transition + scheduled cleanup, handled in a later slice.

-- 6.5 auth_identities: self-only RW. Service role bypasses RLS for the trigger.
create policy auth_identities_select_self on public.auth_identities
  for select using (auth.uid() = user_id);
create policy auth_identities_insert_self on public.auth_identities
  for insert with check (auth.uid() = user_id);
create policy auth_identities_delete_self on public.auth_identities
  for delete using (auth.uid() = user_id);

-- 6.6 devices: self-only RW.
create policy devices_select_self on public.devices
  for select using (auth.uid() = user_id);
create policy devices_insert_self on public.devices
  for insert with check (auth.uid() = user_id);
create policy devices_update_self on public.devices
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy devices_delete_self on public.devices
  for delete using (auth.uid() = user_id);

-- ── 7. Grants ──────────────────────────────────────────────────────────────
-- The `anon` and `authenticated` roles get table-level USAGE on the schema.
-- Per-row access is enforced by RLS policies above; per-column UPDATE grants
-- prevent privilege escalation (no client can flip `is_super_admin`, mutate
-- counters, or change immutable identifiers).
grant usage on schema public to anon, authenticated;

grant select on public.cities to anon, authenticated;

grant select on public.users to anon, authenticated;
grant update (
  display_name,
  city,
  city_name,
  biography,
  avatar_url,
  privacy_mode,
  privacy_changed_at,
  notification_preferences,
  onboarding_state,
  closure_explainer_dismissed,
  first_post_nudge_dismissed,
  updated_at
) on public.users to authenticated;

grant select, insert, delete on public.auth_identities to authenticated;

grant select, insert, update, delete on public.devices to authenticated;
