-- Research · public research form (FR-RESEARCH-001..003)
--
-- A survey of `public.surveys` can also be answered by people without an account, on a web
-- page. Their answers never touch the API schema: the page calls the `public-research-submit`
-- Edge Function, which checks the origin, hashes the visitor's address with a salt that
-- changes every day, and calls the one function below with the service role. The raw
-- address never reaches the database, and the three tables are reachable by no client role.

create table kc_private.research_responses (
  id              uuid primary key default gen_random_uuid(),
  -- Slug and version as answered; no foreign key, so answers outlive a retired survey.
  survey_slug     text not null,
  version         integer not null check (version >= 1),
  -- Campaign the visitor came from (`?src=`); FR-RESEARCH-001 AC4.
  source          text not null default 'direct' check (source ~ '^[a-z0-9_-]{1,32}$'),
  -- SHA-256 of the visitor's address / user agent with the day's salt, hex. Never raw.
  ip_hash         text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent_hash text check (user_agent_hash ~ '^[0-9a-f]{64}$'),
  -- { "<question id>": { "rating": int, "answer_text": text|null } }
  answers         jsonb not null check (jsonb_typeof(answers) = 'object'),
  created_at      timestamptz not null default now()
);
comment on table kc_private.research_responses is 'Anonymous answers to a public research survey. Written by submit_public_research_response().';

-- Per-visitor rate limits: answers of one address hash in the last minute, hour and day.
create index research_responses_ip_recent_idx on kc_private.research_responses (ip_hash, created_at desc);
-- Circuit breaker: all answers of the last minute.
create index research_responses_created_idx on kc_private.research_responses (created_at desc);

-- A visitor who asked to be contacted. Kept apart from the answers so either can be
-- deleted without the other (FR-RESEARCH-003 AC2).
create table kc_private.research_contact_requests (
  id             uuid primary key default gen_random_uuid(),
  response_id    uuid not null references kc_private.research_responses (id) on delete cascade,
  contact_email  text not null check (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(contact_email) <= 254),
  -- When the visitor prefers to be contacted, in their own words.
  contact_window text check (char_length(contact_window) between 1 and 200),
  consent_at     timestamptz not null default now()
);
comment on table kc_private.research_contact_requests is 'Contact details a research respondent chose to leave.';

-- Covers the response foreign key.
create index research_contact_requests_response_idx on kc_private.research_contact_requests (response_id);

-- The rotating salt (`daily_research_salt`). A value is created on first use, so no secret
-- is ever written into a migration.
create table kc_private.research_secrets (
  key        text primary key check (key = 'daily_research_salt'),
  value      text not null check (char_length(value) >= 32),
  rotated_at timestamptz not null default now()
);
comment on table kc_private.research_secrets is 'Rotating salt for hashing research visitors. Service role only.';

alter table kc_private.research_responses enable row level security;
alter table kc_private.research_responses force row level security;
alter table kc_private.research_contact_requests enable row level security;
alter table kc_private.research_contact_requests force row level security;
alter table kc_private.research_secrets enable row level security;
alter table kc_private.research_secrets force row level security;

-- Sets a fresh random salt and returns when. Called daily through the
-- `rotate-research-salt` Edge Function; after it, yesterday's hashes can no longer be
-- linked to today's visitors.
create function public.rotate_research_salt()
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  insert into kc_private.research_secrets as s (key, value)
  values ('daily_research_salt', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (key) do update set value = excluded.value, rotated_at = now()
  returning s.rotated_at;
$$;
comment on function public.rotate_research_salt() is 'Replaces the research salt with a new random value. Service role only.';

-- The current salt, for the Edge Function that hashes the visitor's address; creates the
-- first one when none exists yet.
create function public.get_research_salt()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value text;
begin
  select s.value into v_value from kc_private.research_secrets s where s.key = 'daily_research_salt';
  if not found then
    perform public.rotate_research_salt();
    select s.value into v_value from kc_private.research_secrets s where s.key = 'daily_research_salt';
  end if;
  return v_value;
end;
$$;
comment on function public.get_research_salt() is 'The current research salt. Service role only.';

-- Stores one anonymous response and, when given, the contact request. Returns the
-- response id.
--   honeypot    a filled hidden field returns a random id and stores nothing (AC1)
--   survey_not_found_or_version_mismatch   the slug is not an active survey at this version
--   rate_limited_minute | _hour | _day     more than 5 / 30 / 100 from one address hash (AC3)
--   research_circuit_open                  more than 500 responses in the last minute (AC4)
--   invalid_input                          answers are not an object
create function public.submit_public_research_response(
  p_slug text, p_version integer, p_source text, p_ip_hash text, p_user_agent_hash text,
  p_answers jsonb, p_honeypot text, p_contact_email text default null,
  p_contact_window_he text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response_id uuid;
  v_recent record;
begin
  if nullif(btrim(p_honeypot), '') is not null then
    return gen_random_uuid();
  end if;
  if not exists (select 1 from public.surveys s
                  where s.slug = p_slug and s.is_active and s.current_version = p_version) then
    raise exception 'survey_not_found_or_version_mismatch' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  select count(*) filter (where r.created_at > now() - interval '1 minute') as last_minute,
         count(*) filter (where r.created_at > now() - interval '1 hour') as last_hour,
         count(*) as last_day
    into v_recent
    from kc_private.research_responses r
   where r.ip_hash = p_ip_hash and r.created_at > now() - interval '1 day';
  if v_recent.last_minute >= 5 then
    raise exception 'rate_limited_minute' using errcode = 'P0001';
  elsif v_recent.last_hour >= 30 then
    raise exception 'rate_limited_hour' using errcode = 'P0001';
  elsif v_recent.last_day >= 100 then
    raise exception 'rate_limited_day' using errcode = 'P0001';
  end if;
  if (select count(*) from kc_private.research_responses r
       where r.created_at > now() - interval '1 minute') > 500 then
    raise exception 'research_circuit_open' using errcode = 'P0001';
  end if;

  insert into kc_private.research_responses (survey_slug, version, source, ip_hash, user_agent_hash, answers)
  values (p_slug, p_version, coalesce(nullif(btrim(p_source), ''), 'direct'), p_ip_hash,
          p_user_agent_hash, p_answers)
  returning id into v_response_id;
  if nullif(btrim(p_contact_email), '') is not null then
    insert into kc_private.research_contact_requests (response_id, contact_email, contact_window)
    values (v_response_id, btrim(p_contact_email), nullif(btrim(p_contact_window_he), ''));
  end if;
  return v_response_id;
end;
$$;
comment on function public.submit_public_research_response(text, integer, text, text, text, jsonb, text, text, text) is
  'public-research-submit: stores one anonymous research response after the abuse checks. Service role only.';

-- The questions of a survey's current version, for the public form:
-- { slug, title_he, description_he, version, questions: [...] }, or null when the survey is
-- not active. The page reads it with the anonymous key, so signed-out callers may execute it
-- (the questions of an active survey are public by design; nothing else is reachable through it).
create function public.get_public_research_questions(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'slug', s.slug, 'title_he', s.title_he, 'description_he', s.description_he,
           'version', s.current_version,
           'questions', coalesce((
             select jsonb_agg(to_jsonb(q) - 'survey_version_id' order by q.sort_order)
               from public.survey_questions q where q.survey_version_id = v.id), '[]'::jsonb))
    from public.surveys s
    join public.survey_versions v on v.survey_id = s.id and v.version = s.current_version
   where s.slug = p_slug and s.is_active;
$$;
comment on function public.get_public_research_questions(text) is
  'Questions of the current version of an active survey, for the public research form. Open to signed-out and signed-in callers.';
grant execute on function public.get_public_research_questions(text) to anon, authenticated;
