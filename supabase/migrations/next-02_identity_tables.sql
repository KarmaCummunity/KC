-- Platform · KC's own identity: who a member signs in as, and their sessions (ADR-013)
--
-- Supabase Auth keeps a member's sign-in identities, password hash, sessions and refresh tokens
-- in tables of its own. KC's identity module (app/apps/api) keeps them here instead. Nothing
-- reads these tables until that module is switched on, in the database cut-over; until then
-- they are empty.
--
-- `auth.users` stays the member's row: every table below references it and is removed with it,
-- so the account purge keeps deleting one row. No client role can reach `kc_private` at all; the
-- API reads and writes these tables as the service role. Row security is on with no policy, so a
-- grant made by mistake to another role still shows it nothing.
--
-- No secret is stored in a readable form: passwords as hashes, refresh tokens and one-time links
-- as SHA-256 digests of values that are 256 random bits.

-- How a member proves who they are: one row per provider account, or per email address with a password.
create table kc_private.auth_identities (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  provider        text not null check (provider in ('google', 'apple', 'email')),
  -- What the provider calls the member: the subject of its ID token; for 'email', the address in lower case.
  subject         text not null check (char_length(subject) between 1 and 320),
  created_at      timestamptz not null default now(),
  last_sign_in_at timestamptz,
  constraint auth_identities_provider_subject_key unique (provider, subject)
);
comment on table kc_private.auth_identities is
  'Sign-in identities of KC''s own identity module (ADR-013): a provider account or an email address, each of one member.';
create index auth_identities_user_idx on kc_private.auth_identities (user_id);

-- The password of a member who signs in with an email address.
create table kc_private.auth_passwords (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  -- A bcrypt hash carried over from Supabase Auth ('$2…'), or one KC made ('scrypt$…').
  hash       text not null check (char_length(hash) between 20 and 400),
  updated_at timestamptz not null default now()
);
comment on table kc_private.auth_passwords is
  'Password hashes of KC''s own identity module (ADR-013). Never a password.';

-- One sign-in on one device, from the sign-in until it ends.
create table kc_private.auth_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  -- The last time the session was issued tokens: at sign-in, then at every refresh.
  refreshed_at timestamptz not null default now(),
  ended_at     timestamptz,
  ended_reason text check (ended_reason in ('signed_out', 'signed_out_everywhere', 'password_reset', 'token_reuse')),
  constraint auth_sessions_ended_chk check ((ended_at is null) = (ended_reason is null))
);
comment on table kc_private.auth_sessions is
  'Sessions of KC''s own identity module (ADR-013). A session that ended, or was not refreshed for 30 days, proves nobody.';
-- "End every session of this member" and "this member's open sessions".
create index auth_sessions_open_idx on kc_private.auth_sessions (user_id) where ended_at is null;

-- The refresh tokens of a session: the current one, and the ones it replaced.
create table kc_private.auth_refresh_tokens (
  -- SHA-256 of the token. The token itself exists only on the member's device.
  token_hash  bytea primary key check (octet_length(token_hash) = 32),
  session_id  uuid not null references kc_private.auth_sessions (id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- When the token was exchanged for its successor; null for the session's current token.
  replaced_at timestamptz
);
comment on table kc_private.auth_refresh_tokens is
  'Refresh tokens of KC''s own identity module (ADR-013), as digests. A replaced token that is presented again ends its session.';
create index auth_refresh_tokens_session_idx on kc_private.auth_refresh_tokens (session_id);

-- A secret handed to a member that works once, until it expires: the link in an email, or the code
-- a browser sign-in ends with.
create table kc_private.auth_one_time_tokens (
  token_hash     bytea primary key check (octet_length(token_hash) = 32),
  user_id        uuid not null references auth.users (id) on delete cascade,
  purpose        text not null check (purpose in ('verify_email', 'reset_password', 'sign_in_code')),
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  used_at        timestamptz,
  -- A sign-in code only works for the app instance that started the sign-in: it must present the
  -- secret whose SHA-256 (base64url) this is (PKCE, RFC 7636).
  code_challenge text check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  constraint auth_one_time_tokens_window_chk check (expires_at > created_at),
  constraint auth_one_time_tokens_challenge_chk check ((purpose = 'sign_in_code') = (code_challenge is not null))
);
comment on table kc_private.auth_one_time_tokens is
  'Single-use secrets of KC''s own identity module (ADR-013): email verification, password reset and browser sign-in codes, as digests.';
-- A new link replaces the member's earlier ones of the same purpose.
create index auth_one_time_tokens_user_idx on kc_private.auth_one_time_tokens (user_id, purpose);

alter table kc_private.auth_identities      enable row level security;
alter table kc_private.auth_identities      force row level security;
alter table kc_private.auth_passwords       enable row level security;
alter table kc_private.auth_passwords       force row level security;
alter table kc_private.auth_sessions        enable row level security;
alter table kc_private.auth_sessions        force row level security;
alter table kc_private.auth_refresh_tokens  enable row level security;
alter table kc_private.auth_refresh_tokens  force row level security;
alter table kc_private.auth_one_time_tokens enable row level security;
alter table kc_private.auth_one_time_tokens force row level security;

-- How long a session lives without being refreshed (FR-AUTH-007 AC4).
create function kc_private.auth_session_idle_limit()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '30 days';
$$;

-- Whether a session still proves its member: it exists, is that member's, has not ended, and was
-- refreshed within the idle limit. The API asks this for every request that carries a session.
create function kc_private.auth_session_is_live(p_session_id uuid, p_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from kc_private.auth_sessions s
     where s.id = p_session_id
       and s.user_id = p_user_id
       and s.ended_at is null
       and s.refreshed_at > now() - kc_private.auth_session_idle_limit()
  );
$$;

-- The member as a session describes them. `auth.users` is not readable by the service role, here
-- or on the platform, so the read is this function's: it returns the columns a session needs and
-- nothing else of the row.
create function kc_private.auth_session_user(p_user_id uuid)
returns table (
  id                 uuid,
  email              text,
  email_confirmed_at timestamptz,
  phone              text,
  meta               jsonb,
  provider           text,
  created_at         timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::text, u.email_confirmed_at, u.phone::text, u.raw_user_meta_data,
         u.raw_app_meta_data ->> 'provider', u.created_at
    from auth.users u
   where u.id = p_user_id;
$$;

-- ── The member's row, written for the identity module ───────────────────────────────────────────
-- `auth.users` is not writable by the service role either. Each function below does one thing to
-- one row; the triggers on the table do the rest, as they do for a sign-up today.

-- The member an address belongs to, whatever they signed up with. Addresses are stored in lower case.
create function kc_private.auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u where u.email = lower(p_email) order by u.created_at limit 1;
$$;

-- Creates a member. `on_auth_user_created` builds their profile and account from this row:
-- active at once when the address is verified (a provider vouched for it), pending otherwise.
create function kc_private.auth_user_create(p_email text, p_provider text, p_email_verified boolean, p_profile jsonb)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into auth.users (email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
  values (
    lower(p_email),
    case when p_email_verified then now() end,
    coalesce(p_profile, '{}'::jsonb),
    jsonb_build_object('provider', p_provider, 'providers', jsonb_build_array(p_provider))
  )
  returning id;
$$;

-- Records that the member proved the address is theirs; `on_auth_user_verified` activates the account.
create function kc_private.auth_user_confirm_email(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update auth.users set email_confirmed_at = now() where id = p_user_id and email_confirmed_at is null;
$$;

-- Merges name and picture fields into what the member's sign-in profile says (D-38: the product's
-- own tables are the source of truth; this copy is kept in step with them).
create function kc_private.auth_user_merge_profile(p_user_id uuid, p_patch jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || p_patch where id = p_user_id;
$$;

-- ── Carrying the accounts over from Supabase Auth (ADR-013 section 5) ───────────────────────────
-- Supabase Auth keeps identities, password hashes, sessions and refresh tokens in tables of its
-- own, in this same database. At the cut-over they are copied into the tables above, so that a
-- member keeps their password and stays signed in:
--
--   identities      as they are; an email identity is known by its address, a provider's by the
--                   provider's own id of the account
--   passwords       the bcrypt hash as it is (the identity module verifies it and replaces it at
--                   the member's next sign-in)
--   sessions        the ones that have not ended and still hold a token that was not revoked,
--                   under the id they already have
--   refresh tokens  the tokens of those sessions that were not revoked, as SHA-256 digests: the
--                   text Supabase Auth stores is not copied
--
-- It can be run again at any time and adds only what is missing; it changes and removes nothing.
-- On a database that has no Supabase Auth tables it does nothing and says so.
create function kc_private.auth_copy_from_supabase()
returns table (source_present boolean, identities bigint, passwords bigint, sessions bigint, refresh_tokens bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identities bigint := 0;
  v_passwords bigint := 0;
  v_sessions bigint := 0;
  v_tokens bigint := 0;
begin
  if to_regclass('auth.identities') is null or to_regclass('auth.sessions') is null or to_regclass('auth.refresh_tokens') is null then
    return query select false, 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  insert into kc_private.auth_identities (user_id, provider, subject, created_at, last_sign_in_at)
  select i.user_id,
         i.provider,
         case when i.provider = 'email' then lower(coalesce(i.identity_data ->> 'email', u.email)) else i.provider_id end,
         coalesce(i.created_at, now()),
         i.last_sign_in_at
    from auth.identities i
    join auth.users u on u.id = i.user_id
   where i.provider in ('google', 'apple', 'email')
     and (i.provider <> 'email' or coalesce(i.identity_data ->> 'email', u.email) is not null)
  on conflict (provider, subject) do nothing;
  get diagnostics v_identities = row_count;

  insert into kc_private.auth_passwords (user_id, hash)
  select u.id, u.encrypted_password
    from auth.users u
   where coalesce(u.encrypted_password, '') <> ''
  on conflict (user_id) do nothing;
  get diagnostics v_passwords = row_count;

  insert into kc_private.auth_sessions (id, user_id, created_at, refreshed_at)
  select s.id, s.user_id, coalesce(s.created_at, now()), coalesce(s.refreshed_at, s.updated_at, s.created_at, now())
    from auth.sessions s
   where (s.not_after is null or s.not_after > now())
     and exists (select 1 from auth.refresh_tokens t where t.session_id = s.id and not coalesce(t.revoked, false))
  on conflict (id) do nothing;
  get diagnostics v_sessions = row_count;

  insert into kc_private.auth_refresh_tokens (token_hash, session_id, created_at)
  select pg_catalog.sha256(pg_catalog.convert_to(t.token, 'UTF8')), t.session_id, coalesce(t.created_at, now())
    from auth.refresh_tokens t
    join kc_private.auth_sessions s on s.id = t.session_id and s.ended_at is null
   where not coalesce(t.revoked, false) and t.token is not null
  on conflict (token_hash) do nothing;
  get diagnostics v_tokens = row_count;

  return query select true, v_identities, v_passwords, v_sessions, v_tokens;
end;
$$;
