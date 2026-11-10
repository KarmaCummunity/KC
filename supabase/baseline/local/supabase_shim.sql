-- Stand-in for the objects the Supabase platform provides, for building the baseline on a plain
-- PostgreSQL server (scripts/run-baseline-tests.sh --plain). Never part of the baseline and
-- never applied to a Supabase project: there these objects already exist.

-- API roles. `create role` has no IF NOT EXISTS, and roles are cluster-wide: on a Supabase
-- server they already exist and are left untouched.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

-- Supabase installs extensions here.
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- Minimal auth schema: the users table and the two JWT accessors RLS policies call.
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  phone text,
  email_confirmed_at timestamptz,
  phone_confirmed_at timestamptz,
  raw_user_meta_data jsonb,
  raw_app_meta_data jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', 'anon');
$$;

-- The blanket grants a fresh Supabase project carries on `public`; the baseline must remove them.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;

-- Minimal realtime schema: the table Broadcast authorization policies are written on, the
-- topic accessor those policies call, and `realtime.send`, which on the platform stores the
-- event in the same table. Tests read `realtime.messages` to assert what was broadcast.
create schema if not exists realtime;
grant usage on schema realtime to authenticated, service_role;

create table if not exists realtime.messages (
  id uuid not null default gen_random_uuid(),
  topic text not null,
  extension text not null,
  payload jsonb,
  event text,
  private boolean default false,
  inserted_at timestamp not null default now()
);
alter table realtime.messages enable row level security;
grant select, insert on realtime.messages to authenticated;

create or replace function realtime.topic()
returns text
language sql
stable
as $$
  select nullif(current_setting('realtime.topic', true), '');
$$;

create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void
language sql
as $$
  insert into realtime.messages (payload, event, topic, private, extension)
  values (payload, event, topic, private, 'broadcast');
$$;

-- Minimal storage schema: the bucket registry, the object table storage policies are
-- written on, and the path helper those policies call. Tests assert the bucket rows and
-- exercise the policies by writing object rows as a member.
create schema if not exists storage;
grant usage on schema storage to authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1];
$$;
