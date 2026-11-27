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

-- A link sent to a member's address: it works once, until it expires.
create table kc_private.auth_one_time_tokens (
  token_hash bytea primary key check (octet_length(token_hash) = 32),
  user_id    uuid not null references auth.users (id) on delete cascade,
  purpose    text not null check (purpose in ('verify_email', 'reset_password')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz,
  constraint auth_one_time_tokens_window_chk check (expires_at > created_at)
);
comment on table kc_private.auth_one_time_tokens is
  'Single-use links of KC''s own identity module (ADR-013): email verification and password reset, as digests.';
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
