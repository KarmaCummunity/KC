-- 0131_public_research_responses.sql
-- FR-RESEARCH-001, FR-RESEARCH-002, FR-RESEARCH-003 — anonymous public market-research form (Survey B)
-- Design spec: docs/superpowers/specs/2026-05-25-surveys-and-feedback-design.md §6, §7, §9
-- Seeds Survey B "alt-platforms-research" v1 (11 questions) at the end of this file.
-- (Numbered 0131 — follows surveys migration 0130 after dev's parallel admin/rides/feed migrations.)
-- Question content reuses existing surveys / survey_versions / survey_questions tables from 0130.
-- Only the anonymous answer rows go to a new dedicated table.

begin;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- public_research_responses — anonymous per-submission row.
-- RLS enabled with NO policies → denies all reads/writes to anon + authenticated.
-- Only the SECURITY DEFINER RPC (submit_public_research_response) and service-role
-- can insert; service-role reads happen via admin portal or Edge Functions.
create table if not exists public.public_research_responses (
  id              uuid        primary key default gen_random_uuid(),
  survey_slug     text        not null,
  version         int         not null,
  source          text        not null default 'direct'
                              check (source ~ '^[a-z0-9_-]{1,32}$'),
  ip_hash         text        not null,
  -- answers shape: { "<question_id>": { "rating": int, "answer_text": text|null } }
  answers         jsonb       not null,
  user_agent_hash text        null,   -- for bot-pattern detection; never raw UA
  created_at      timestamptz not null default now()
);

comment on table public.public_research_responses is
  'Anonymous Survey B response rows. RLS deny-all; inserts only via submit_public_research_response(). FR-RESEARCH-001.';

comment on column public.public_research_responses.ip_hash is
  'SHA-256 of x-forwarded-for + daily_research_salt, computed by Edge Function. Never raw IP. FR-RESEARCH-002 AC3.';

comment on column public.public_research_responses.source is
  'UTM-like campaign source from ?src= query param. Defaults to ''direct''. Regex ^[a-z0-9_-]{1,32}$. FR-RESEARCH-001 AC4.';

-- ---------------------------------------------------------------------------
-- public_research_contact_requests — PII-isolated contact opt-in.
-- Linked to responses via FK; independent deletion satisfies Israeli privacy law.
-- RLS enabled with NO policies → service-role only.
-- Super-admin read happens via a dedicated RPC (out of scope V1; see TD-150 note below).
create table if not exists public.public_research_contact_requests (
  id                uuid        primary key default gen_random_uuid(),
  response_id       uuid        not null
                                references public.public_research_responses(id)
                                on delete cascade,
  contact_email     text        not null
                                check (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_window_he text        null
                                check (
                                  contact_window_he is null
                                  or char_length(contact_window_he) <= 200
                                ),
  consent_at        timestamptz not null default now()
);

comment on table public.public_research_contact_requests is
  'PII-isolated contact email + availability window for Survey B opt-in. FK cascade delete from public_research_responses. FR-RESEARCH-003.';

-- TD-150: super-admin SELECT on public_research_contact_requests currently requires
-- service-role (direct DB/admin-portal). A dedicated SECURITY DEFINER RPC for super-admin
-- read is deferred to V1.1 to keep this migration focused on ingestion.

-- ---------------------------------------------------------------------------
-- research_secrets — daily-rotated IP-hash salt.
-- Seeded with an initial value; rotation is handled by Edge Function rotate-research-salt.
-- RLS enabled with NO policies → service-role only.
create table if not exists public.research_secrets (
  key        text        primary key,
  value      text        not null,
  rotated_at timestamptz not null default now()
);

comment on table public.research_secrets is
  'Key-value store for security secrets (daily_research_salt). Rotated daily by rotate-research-salt Edge Function. FR-RESEARCH-002 AC3.';

-- Seed initial salt (idempotent: on conflict do nothing)
insert into public.research_secrets (key, value)
values ('daily_research_salt', encode(gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Slug + time: analytical queries and per-survey counts
create index if not exists public_research_responses_slug_created_idx
  on public.public_research_responses (survey_slug, created_at desc);

-- Source: per-channel aggregation
create index if not exists public_research_responses_source_idx
  on public.public_research_responses (source);

-- IP-hash + time: rate-limit lookups inside submit_public_research_response
create index if not exists public_research_responses_iphash_created_idx
  on public.public_research_responses (ip_hash, created_at desc);

-- Contact-request → response join
create index if not exists public_research_contact_requests_response_idx
  on public.public_research_contact_requests (response_id);

-- ---------------------------------------------------------------------------
-- RLS (deny-all: no policies → zero access for anon + authenticated)
-- ---------------------------------------------------------------------------

alter table public.public_research_responses       enable row level security;
alter table public.public_research_contact_requests enable row level security;
alter table public.research_secrets                enable row level security;

-- Explicit deny-all policies for anon + authenticated. Service-role bypasses
-- RLS and is the only read/write path outside the SECURITY DEFINER RPC.
-- rls-lint.sql requires every public table with RLS to have at least one policy.

drop policy if exists public_research_responses_deny_all on public.public_research_responses;
create policy public_research_responses_deny_all
  on public.public_research_responses
  for all to anon, authenticated
  using (false) with check (false);

drop policy if exists public_research_contact_requests_deny_all on public.public_research_contact_requests;
create policy public_research_contact_requests_deny_all
  on public.public_research_contact_requests
  for all to anon, authenticated
  using (false) with check (false);

drop policy if exists research_secrets_deny_all on public.research_secrets;
create policy research_secrets_deny_all
  on public.research_secrets
  for all to anon, authenticated
  using (false) with check (false);

-- ---------------------------------------------------------------------------
-- Table grants: no direct access for anon or authenticated
-- ---------------------------------------------------------------------------

revoke all on public.public_research_responses        from anon, authenticated;
revoke all on public.public_research_contact_requests from anon, authenticated;
revoke all on public.research_secrets                 from anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: submit_public_research_response
-- Anon-callable; all protections live inside the function body.
-- Edge Function public-research-submit computes ip_hash + user_agent_hash before calling.
-- ---------------------------------------------------------------------------

create or replace function public.submit_public_research_response(
  p_slug              text,
  p_version           int,
  p_source            text,
  p_ip_hash           text,         -- passed by Edge Function (x-forwarded-for hashed)
  p_user_agent_hash   text,
  p_answers           jsonb,        -- { "<question_id>": { "rating": int, "answer_text": text|null } }
  p_honeypot          text,         -- must be null or empty string
  p_contact_email     text default null,
  p_contact_window_he text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response_id   uuid;
  v_survey_id     uuid;
  v_minute_count  int;
  v_hour_count    int;
  v_day_count     int;
  v_global_count  int;
begin
  -- ------------------------------------------------------------
  -- Honeypot trip → silent success (no insert, fake uuid)
  -- Bots receive a plausible 200 OK so they do not probe further.
  -- ------------------------------------------------------------
  if p_honeypot is not null and length(trim(p_honeypot)) > 0 then
    return gen_random_uuid();
  end if;

  -- ------------------------------------------------------------
  -- Resolve active survey: slug must match + version must equal current_version
  -- ------------------------------------------------------------
  select id into v_survey_id
    from public.surveys
   where slug            = p_slug
     and is_active       = true
     and current_version = p_version;

  if v_survey_id is null then
    raise exception 'survey_not_found_or_version_mismatch' using errcode = '22023';
  end if;

  -- ------------------------------------------------------------
  -- Per-IP-hash rate limits (FR-RESEARCH-002 AC3)
  -- ------------------------------------------------------------

  -- 5 per minute
  select count(*) into v_minute_count
    from public.public_research_responses
   where ip_hash    = p_ip_hash
     and created_at > now() - interval '1 minute';

  if v_minute_count >= 5 then
    raise exception 'rate_limited_minute' using errcode = '22023';
  end if;

  -- 30 per hour
  select count(*) into v_hour_count
    from public.public_research_responses
   where ip_hash    = p_ip_hash
     and created_at > now() - interval '1 hour';

  if v_hour_count >= 30 then
    raise exception 'rate_limited_hour' using errcode = '22023';
  end if;

  -- 100 per day
  select count(*) into v_day_count
    from public.public_research_responses
   where ip_hash    = p_ip_hash
     and created_at > now() - interval '1 day';

  if v_day_count >= 100 then
    raise exception 'rate_limited_day' using errcode = '22023';
  end if;

  -- ------------------------------------------------------------
  -- Global circuit breaker — >500 inserts in the last 60 seconds
  -- across all sources (FR-RESEARCH-002 AC4)
  -- ------------------------------------------------------------
  select count(*) into v_global_count
    from public.public_research_responses
   where created_at > now() - interval '1 minute';

  if v_global_count > 500 then
    raise exception 'research_circuit_open' using errcode = '53400';
  end if;

  -- ------------------------------------------------------------
  -- Insert response
  -- ------------------------------------------------------------
  insert into public.public_research_responses
    (survey_slug, version, source, ip_hash, answers, user_agent_hash)
  values
    (
      p_slug,
      p_version,
      coalesce(nullif(trim(p_source), ''), 'direct'),
      p_ip_hash,
      p_answers,
      p_user_agent_hash
    )
  returning id into v_response_id;

  -- ------------------------------------------------------------
  -- Optional contact-request insert (FR-RESEARCH-003 AC1)
  -- ------------------------------------------------------------
  if p_contact_email is not null and length(trim(p_contact_email)) > 0 then
    insert into public.public_research_contact_requests
      (response_id, contact_email, contact_window_he)
    values
      (v_response_id, trim(p_contact_email), p_contact_window_he);
  end if;

  return v_response_id;
end;
$$;

revoke all on function public.submit_public_research_response(
  text, int, text, text, text, jsonb, text, text, text
) from public;

grant execute on function public.submit_public_research_response(
  text, int, text, text, text, jsonb, text, text, text
) to anon;

comment on function public.submit_public_research_response(
  text, int, text, text, text, jsonb, text, text, text
) is
  'Anon-callable RPC. Honeypot + rate-limit + circuit-breaker + survey resolution before insert. IP hash passed by Edge Function. FR-RESEARCH-001, FR-RESEARCH-002, FR-RESEARCH-003.';

-- ---------------------------------------------------------------------------
-- RPC: get_public_research_questions(p_slug text)
-- Anon-callable so the public web form can render questions without auth.
-- Returns: { slug, title_he, version, questions: [...] }
-- Reads from existing surveys / survey_versions / survey_questions (from 0122).
-- ---------------------------------------------------------------------------

create or replace function public.get_public_research_questions(p_slug text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_survey_id  uuid;
  v_version    int;
  v_title_he   text;
  v_desc_he    text;
  v_sv_id      uuid;
  v_questions  json;
begin
  -- Resolve active, published survey
  select id, current_version, title_he, description_he
    into v_survey_id, v_version, v_title_he, v_desc_he
    from public.surveys
   where slug            = p_slug
     and is_active       = true
     and current_version > 0;

  if v_survey_id is null then
    raise exception 'survey_not_found' using errcode = '22023';
  end if;

  -- Resolve the survey_versions row for the current version
  select id into v_sv_id
    from public.survey_versions
   where survey_id = v_survey_id
     and version   = v_version;

  -- Ordered questions (all fields needed to render the runner UI)
  select json_agg(
    json_build_object(
      'id',                    q.id,
      'sort_order',            q.sort_order,
      'question_type',         q.question_type,
      'short_label_he',        q.short_label_he,
      'prompt_he',             q.prompt_he,
      'context_he',            q.context_he,
      'text_placeholder_he',   q.text_placeholder_he,
      'rating_anchor_low_he',  q.rating_anchor_low_he,
      'rating_anchor_high_he', q.rating_anchor_high_he
    ) order by q.sort_order
  )
  into v_questions
  from public.survey_questions q
  where q.survey_version_id = v_sv_id;

  return json_build_object(
    'slug',           p_slug,
    'title_he',       v_title_he,
    'description_he', v_desc_he,
    'version',        v_version,
    'questions',      coalesce(v_questions, '[]'::json)
  );
end;
$$;

revoke all on function public.get_public_research_questions(text) from public;

-- anon only: authenticated users access Survey A questions via get_survey_bundle
grant execute on function public.get_public_research_questions(text) to anon;

comment on function public.get_public_research_questions(text) is
  'Returns survey meta + ordered questions for the anonymous public web form. Anon-callable. FR-RESEARCH-001 AC3.';

-- ---------------------------------------------------------------------------
-- Seed: Survey B "alt-platforms-research" v1 — 11 questions from design spec §9
-- Executed at migration-apply time via the publish_survey_version RPC (from 0122).
-- If no super-admin user exists yet (fresh CI stack), the seed is skipped
-- gracefully; operators can re-run via Supabase Studio.
-- ---------------------------------------------------------------------------

do $$
declare
  v_admin  uuid;
  v_result json;
begin
  select user_id into v_admin
    from public.users
   where is_super_admin = true
   order by created_at asc
   limit 1;

  if v_admin is null then
    raise notice 'no super-admin found; skipping alt-platforms-research v1 seed. Run publish_survey_version manually after provisioning a super-admin.';
    return;
  end if;

  -- publish_survey_version handles upsert of survey row + version + questions atomically.
  -- Running as postgres (no JWT) so the auth.uid() null-path inside the RPC uses
  -- v_admin as published_by.
  -- prompt_rules is '{}' — Survey B is public-only, no in-app banner context.
  select public.publish_survey_version(
    'alt-platforms-research',
    'סקר שוק — פלטפורמות אלטרנטיביות',
    'אנונימי. 11 שאלות. עוזר לנו לבנות אפליקציה ישראלית לנתינה בלי הבלגן.',
    true,
    '{}'::jsonb,
    $q$[
      {
        "short_label_he": "מסירה אחרונה",
        "prompt_he": "הפעם האחרונה שמסרת משהו בחינם (לא משנה איפה) — איך הייתה החוויה?",
        "context_he": "",
        "text_placeholder_he": "תאר/י איך זה התגלגל — מההחלטה ועד שמישהו לקח",
        "rating_anchor_low_he": "סיוט",
        "rating_anchor_high_he": "חלק"
      },
      {
        "short_label_he": "קבלה אחרונה",
        "prompt_he": "הפעם האחרונה שניסית לקבל משהו בחינם — איך הייתה החוויה?",
        "context_he": "",
        "text_placeholder_he": "ספר/י מה קרה",
        "rating_anchor_low_he": "ויתרתי באמצע",
        "rating_anchor_high_he": "קיבלתי בקלות"
      },
      {
        "short_label_he": "מקום ותדירות",
        "prompt_he": "כמה את/ה משתמש/ת בקבוצות ווטסאפ, פייסבוק או אגורה כדי לתת ולקבל בחינם?",
        "context_he": "",
        "text_placeholder_he": "באילו פלטפורמות בעיקר, וכמה פעמים בשבוע?",
        "rating_anchor_low_he": "כמעט אף פעם",
        "rating_anchor_high_he": "כל יום"
      },
      {
        "short_label_he": "תסכול בפעם האחרונה",
        "prompt_he": "בפעם האחרונה שהשתמשת בקבוצה כזו — עד כמה זה תסכל אותך?",
        "context_he": "",
        "text_placeholder_he": "מה בדיוק קרה?",
        "rating_anchor_low_he": "בכלל לא",
        "rating_anchor_high_he": "נשבעתי לעזוב"
      },
      {
        "short_label_he": "יכולת לסמוך",
        "prompt_he": "באיזו מידה את/ה מצליח/ה להעריך מראש אם הצד השני יבוא / יביא את מה שהבטיח?",
        "context_he": "",
        "text_placeholder_he": "ספר/י על אינטראקציה אחת — טובה או רעה — עם זר/ה בקבוצה",
        "rating_anchor_low_he": "בכלל לא יודע/ת",
        "rating_anchor_high_he": "כמעט תמיד יודע/ת"
      },
      {
        "short_label_he": "חוסר נעימות לבקש",
        "prompt_he": "כמה לא נעים לך לבקש משהו בפומבי בקבוצת השכונה?",
        "context_he": "",
        "text_placeholder_he": "מה הופך את זה ללא נעים — או מה היה הופך אותו לקל?",
        "rating_anchor_low_he": "מת/ה מבושה",
        "rating_anchor_high_he": "לא מפריע לי בכלל"
      },
      {
        "short_label_he": "מסחר חבוי",
        "prompt_he": "האם קרה לך פעם שמסרת משהו בחינם והפריט נמצא נמכר אחר כך באלפי/יד2?",
        "context_he": "",
        "text_placeholder_he": "תאר/י את המקרה — ואיך הרגשת",
        "rating_anchor_low_he": "לא קרה לי",
        "rating_anchor_high_he": "קורה תדיר"
      },
      {
        "short_label_he": "התאמה לעיצוב שלנו",
        "prompt_he": "אנחנו בונים אפליקציה: אנונימית, פיד גיאוגרפי של 1 ק\"מ ממך, מאלצת סגירת פוסט כשמישהו לקח (לא חוזרים אליך אחר כך), אפס מסחר — רק בחינם. עד כמה זה מתחבר למה שאת/ה צריך/ה?",
        "context_he": "",
        "text_placeholder_he": "מה היה משכנע אותך — ומה היה אומר לך \"לא בשבילי\"?",
        "rating_anchor_low_he": "לא קשור אליי",
        "rating_anchor_high_he": "זה בדיוק מה שחיפשתי"
      },
      {
        "short_label_he": "סקרנות לאפליקציה",
        "prompt_he": "אם חבר/ה היה ממליץ/ה על אפליקציה חדשה לנתינה — כמה סביר שתבדוק/י?",
        "context_he": "",
        "text_placeholder_he": "מה היה צריך החבר/ה לומר לך כדי שתורידי?",
        "rating_anchor_low_he": "לא אבדוק",
        "rating_anchor_high_he": "אוריד מיד"
      },
      {
        "short_label_he": "מודעות לקארמה",
        "prompt_he": "שמעת על אפליקציה בשם \"קארמה\" לפני הסקר הזה?",
        "context_he": "",
        "text_placeholder_he": "אם שמעת — מה ידוע לך עליה?",
        "rating_anchor_low_he": "לא שמעתי",
        "rating_anchor_high_he": "אני כבר משתמש/ת"
      },
      {
        "short_label_he": "שיחה איתנו",
        "prompt_he": "יש לך 15 דקות לדבר איתנו ולעזור לעצב את האפליקציה?",
        "context_he": "",
        "text_placeholder_he": "מייל ושעה שנוחה",
        "rating_anchor_low_he": "לא עכשיו",
        "rating_anchor_high_he": "בכיף"
      }
    ]$q$::jsonb
  ) into v_result;

  raise notice 'alt-platforms-research v1 seeded: %', v_result;
end;
$$;

commit;
