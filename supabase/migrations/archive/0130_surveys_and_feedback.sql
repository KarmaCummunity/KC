-- 0130_surveys_and_feedback.sql
-- FR-SETTINGS-015..017 — server-driven survey runner + free feedback
-- Design spec: docs/superpowers/specs/2026-05-25-surveys-and-feedback-design.md §8
-- Seeds Survey A "ux-experience" v1 (6 questions) at the end of this file.
-- (Numbered 0130 — slots 0118–0129 occupied on dev DB by admin-portal,
--  reports, rides, and feed-search migrations whose files landed in parallel.)

begin;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- updated_at trigger function (matches public.set_updated_at() already present
-- in migration 0001; using the same function name so trigger wiring is consistent)
-- Guard: create only if it does not exist yet.
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_updated_at'
  ) then
    execute $fn$
      create or replace function public.set_updated_at()
      returns trigger
      language plpgsql
      as $_$
      begin
        new.updated_at := now();
        return new;
      end;
      $_$;
    $fn$;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'survey_question_type') then
    create type public.survey_question_type as enum ('rating_1_7_with_optional_text');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- surveys — one row per survey slug; current_version = 0 until first publish
create table if not exists public.surveys (
  id               uuid        primary key default gen_random_uuid(),
  slug             text        not null unique,
  title_he         text        not null,
  description_he   text        null,
  is_active        boolean     not null default true,
  current_version  int         not null default 0,
  -- milestone flags for the prompt banner:
  --   { "min_sessions": 3, "require_closure": true, "require_profile_complete": true }
  prompt_rules     jsonb       not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.surveys is
  'Catalog of server-driven surveys. One row per slug. current_version advances on each publish.';

-- survey_versions — immutable snapshot of a publish event
create table if not exists public.survey_versions (
  id           uuid        primary key default gen_random_uuid(),
  survey_id    uuid        not null references public.surveys(id) on delete cascade,
  version      int         not null,
  published_by uuid        not null references auth.users(id),
  published_at timestamptz not null default now(),
  unique (survey_id, version)
);

comment on table public.survey_versions is
  'One row per published version per survey. Immutable after insert.';

-- survey_questions — ordered questions belonging to a specific version
create table if not exists public.survey_questions (
  id                    uuid                       primary key default gen_random_uuid(),
  survey_version_id     uuid                       not null references public.survey_versions(id) on delete cascade,
  sort_order            int                        not null,
  question_type         public.survey_question_type not null default 'rating_1_7_with_optional_text',
  short_label_he        text                       not null,
  prompt_he             text                       not null,
  context_he            text                       not null default '',
  text_placeholder_he   text                       not null default '',
  rating_anchor_low_he  text                       not null default 'לא מספיק',
  rating_anchor_high_he text                       not null default 'מצוין',
  unique (survey_version_id, sort_order)
);

comment on table public.survey_questions is
  'Ordered questions for a specific survey version. rating_anchor_low_he / rating_anchor_high_he are per-question endpoint labels.';

-- survey_answers — upsertable per (user, survey, version, question)
create table if not exists public.survey_answers (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  survey_id   uuid        not null references public.surveys(id) on delete cascade,
  version     int         not null,
  question_id uuid        not null references public.survey_questions(id) on delete cascade,
  rating      int         not null check (rating between 1 and 7),
  answer_text text        null     check (answer_text is null or char_length(answer_text) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, survey_id, version, question_id)
);

comment on table public.survey_answers is
  'One row per (user, survey, version, question). Upsertable while current_version unchanged.';

-- user_feedback — free-form feedback from Settings → Free Feedback
create table if not exists public.user_feedback (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  rating     int         null check (rating is null or rating between 1 and 7),
  body       text        not null check (char_length(trim(body)) between 10 and 500),
  created_at timestamptz not null default now()
);

comment on table public.user_feedback is
  'Optional 1-7 rating + free text from the Settings free-feedback form. FR-SETTINGS-017.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists survey_answers_user_survey_version_idx
  on public.survey_answers (user_id, survey_id, version);

create index if not exists user_feedback_created_at_idx
  on public.user_feedback (created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

drop trigger if exists survey_answers_set_updated_at on public.survey_answers;
create trigger survey_answers_set_updated_at
  before update on public.survey_answers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.surveys         enable row level security;
alter table public.survey_versions enable row level security;
alter table public.survey_questions enable row level security;
alter table public.survey_answers  enable row level security;
alter table public.user_feedback   enable row level security;

-- surveys: any authenticated user can read active surveys that have been published
drop policy if exists surveys_select_active on public.surveys;
create policy surveys_select_active
  on public.surveys for select to authenticated
  using (is_active = true and current_version > 0);

-- survey_versions: any authenticated user can read (needed to resolve bundle)
drop policy if exists survey_versions_select on public.survey_versions;
create policy survey_versions_select
  on public.survey_versions for select to authenticated
  using (true);

-- survey_questions: any authenticated user can read
drop policy if exists survey_questions_select on public.survey_questions;
create policy survey_questions_select
  on public.survey_questions for select to authenticated
  using (true);

-- survey_answers: users read/write only their own rows
drop policy if exists survey_answers_select_own on public.survey_answers;
create policy survey_answers_select_own
  on public.survey_answers for select to authenticated
  using (user_id = auth.uid());

drop policy if exists survey_answers_insert_own on public.survey_answers;
create policy survey_answers_insert_own
  on public.survey_answers for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists survey_answers_update_own on public.survey_answers;
create policy survey_answers_update_own
  on public.survey_answers for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- user_feedback: users insert only their own rows; no self-read policy needed
drop policy if exists user_feedback_insert_own on public.user_feedback;
create policy user_feedback_insert_own
  on public.user_feedback for insert to authenticated
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.surveys          from anon, authenticated;
revoke all on public.survey_versions  from anon, authenticated;
revoke all on public.survey_questions from anon, authenticated;
revoke all on public.survey_answers   from anon, authenticated;
revoke all on public.user_feedback    from anon, authenticated;

grant select           on public.surveys          to authenticated;
grant select           on public.survey_versions  to authenticated;
grant select           on public.survey_questions to authenticated;
grant select, insert, update on public.survey_answers to authenticated;
grant insert           on public.user_feedback    to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: get_survey_bundle(p_slug text)
-- Returns JSON: survey meta, current version, ordered questions with anchors,
-- and the calling user's existing answers for that version.
-- ---------------------------------------------------------------------------

create or replace function public.get_survey_bundle(p_slug text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_survey_id  uuid;
  v_version    int;
  v_title_he   text;
  v_desc_he    text;
  v_sv_id      uuid;
  v_questions  json;
  v_answers    json;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Resolve active survey
  select id, current_version, title_he, description_he
    into v_survey_id, v_version, v_title_he, v_desc_he
    from public.surveys
   where slug = p_slug
     and is_active = true
     and current_version > 0;

  if v_survey_id is null then
    raise exception 'survey_not_found' using errcode = '22023';
  end if;

  -- Resolve the version row
  select id into v_sv_id
    from public.survey_versions
   where survey_id = v_survey_id and version = v_version;

  -- Ordered questions
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

  -- User's existing answers for this version
  select json_agg(
    json_build_object(
      'question_id',  a.question_id,
      'rating',       a.rating,
      'answer_text',  a.answer_text
    )
  )
  into v_answers
  from public.survey_answers a
  where a.user_id   = v_uid
    and a.survey_id = v_survey_id
    and a.version   = v_version;

  return json_build_object(
    'slug',           p_slug,
    'title_he',       v_title_he,
    'description_he', v_desc_he,
    'version',        v_version,
    'questions',      coalesce(v_questions, '[]'::json),
    'answers',        coalesce(v_answers,   '[]'::json)
  );
end;
$$;

revoke all on function public.get_survey_bundle(text) from public, anon;
grant execute on function public.get_survey_bundle(text) to authenticated;

comment on function public.get_survey_bundle(text) is
  'Returns survey meta, questions with per-question anchors, and existing answers for auth.uid(). FR-SETTINGS-016.';

-- ---------------------------------------------------------------------------
-- RPC: upsert_survey_answers(p_slug text, p_answers jsonb)
-- p_answers shape: [{ "question_id": "uuid", "rating": 1..7, "answer_text": "..." }]
-- Validates: slug active, each question belongs to current version, rating 1-7.
-- ---------------------------------------------------------------------------

create or replace function public.upsert_survey_answers(
  p_slug    text,
  p_answers jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_survey_id uuid;
  v_version   int;
  v_sv_id     uuid;
  v_answer    jsonb;
  v_qid       uuid;
  v_rating    int;
  v_text      text;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Resolve active survey
  select id, current_version
    into v_survey_id, v_version
    from public.surveys
   where slug = p_slug
     and is_active = true
     and current_version > 0;

  if v_survey_id is null then
    raise exception 'survey_not_found_or_inactive' using errcode = '22023';
  end if;

  -- Resolve version row
  select id into v_sv_id
    from public.survey_versions
   where survey_id = v_survey_id and version = v_version;

  -- Validate + upsert each answer
  for v_answer in select * from jsonb_array_elements(p_answers)
  loop
    v_qid    := (v_answer->>'question_id')::uuid;
    v_rating := (v_answer->>'rating')::int;
    v_text   := v_answer->>'answer_text';

    -- Rating range check
    if v_rating is null or v_rating < 1 or v_rating > 7 then
      raise exception 'invalid_rating for question %', v_qid using errcode = '22023';
    end if;

    -- Verify question belongs to this survey version
    if not exists (
      select 1 from public.survey_questions
       where id = v_qid and survey_version_id = v_sv_id
    ) then
      raise exception 'question_not_in_current_version: %', v_qid using errcode = '22023';
    end if;

    -- Text length check
    if v_text is not null and char_length(v_text) > 500 then
      raise exception 'answer_text_too_long for question %', v_qid using errcode = '22023';
    end if;

    insert into public.survey_answers
      (user_id, survey_id, version, question_id, rating, answer_text)
    values
      (v_uid, v_survey_id, v_version, v_qid, v_rating, v_text)
    on conflict (user_id, survey_id, version, question_id)
    do update set
      rating      = excluded.rating,
      answer_text = excluded.answer_text,
      updated_at  = now();
  end loop;
end;
$$;

revoke all on function public.upsert_survey_answers(text, jsonb) from public, anon;
grant execute on function public.upsert_survey_answers(text, jsonb) to authenticated;

comment on function public.upsert_survey_answers(text, jsonb) is
  'Upserts survey answers for auth.uid(). Validates slug active, questions belong to current version, rating 1-7. FR-SETTINGS-016 AC4.';

-- ---------------------------------------------------------------------------
-- RPC: list_active_surveys()
-- Returns active surveys with completion_status for auth.uid().
-- completion_status: not_started | in_progress | completed
-- ---------------------------------------------------------------------------

create or replace function public.list_active_surveys()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_rows json;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select json_agg(
    json_build_object(
      'slug',              s.slug,
      'title_he',          s.title_he,
      'description_he',    s.description_he,
      'current_version',   s.current_version,
      'completion_status', case
        when q_total.cnt = 0 then 'not_started'
        when ans_count.cnt >= q_total.cnt then 'completed'
        when ans_count.cnt > 0 then 'in_progress'
        else 'not_started'
      end
    )
    order by s.created_at asc
  )
  into v_rows
  from public.surveys s
  join public.survey_versions sv
    on sv.survey_id = s.id
   and sv.version   = s.current_version
  -- total questions in current version
  join lateral (
    select count(*)::int as cnt
      from public.survey_questions q
     where q.survey_version_id = sv.id
  ) q_total on true
  -- user answers for current version
  left join lateral (
    select count(*)::int as cnt
      from public.survey_answers a
     where a.user_id   = v_uid
       and a.survey_id = s.id
       and a.version   = s.current_version
  ) ans_count on true
  where s.is_active = true
    and s.current_version > 0;

  return coalesce(v_rows, '[]'::json);
end;
$$;

revoke all on function public.list_active_surveys() from public, anon;
grant execute on function public.list_active_surveys() to authenticated;

comment on function public.list_active_surveys() is
  'Lists active surveys with completion_status (not_started|in_progress|completed) for auth.uid(). FR-SETTINGS-015 AC2.';

-- ---------------------------------------------------------------------------
-- RPC: publish_survey_version(p_slug, p_title_he, p_description_he,
--       p_is_active, p_prompt_rules, p_questions)
-- Super-admin only (has_admin_role uid 'super_admin').
-- Creates survey row if needed, bumps version, inserts version + questions.
-- p_questions shape: [{
--   "short_label_he": "...", "prompt_he": "...", "context_he": "...",
--   "text_placeholder_he": "...", "rating_anchor_low_he": "...",
--   "rating_anchor_high_he": "..."
-- }]  — ordered by array index → sort_order 1..N
-- ---------------------------------------------------------------------------

create or replace function public.publish_survey_version(
  p_slug            text,
  p_title_he        text,
  p_description_he  text,
  p_is_active       boolean,
  p_prompt_rules    jsonb,
  p_questions       jsonb
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_survey_id  uuid;
  v_version    int;
  v_sv_id      uuid;
  v_q          jsonb;
  v_i          int  := 0;
  v_publisher  uuid;
begin
  -- Auth gate: must be super_admin
  -- NOTE: auth.uid() may be NULL during migration seeding (running as postgres
  -- role), so we skip the auth check when called without a JWT context.
  if v_uid is not null then
    if not public.has_admin_role(v_uid, 'super_admin') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  -- Validate questions array
  if p_questions is null or jsonb_array_length(p_questions) = 0 then
    raise exception 'questions_required' using errcode = '22023';
  end if;

  -- Upsert survey row
  insert into public.surveys (slug, title_he, description_he, is_active, prompt_rules)
  values (p_slug, p_title_he, p_description_he, p_is_active, coalesce(p_prompt_rules, '{}'::jsonb))
  on conflict (slug) do update set
    title_he       = excluded.title_he,
    description_he = excluded.description_he,
    is_active      = excluded.is_active,
    prompt_rules   = excluded.prompt_rules,
    updated_at     = now()
  returning id into v_survey_id;

  -- Bump version
  update public.surveys
     set current_version = current_version + 1,
         updated_at      = now()
   where id = v_survey_id
  returning current_version into v_version;

  -- Determine publisher: use v_uid if available, else fall back to the first
  -- super-admin user (for migration-time seeding where no JWT is present).
  if v_uid is not null then
    v_publisher := v_uid;
  else
    select user_id into v_publisher
      from public.users
     where is_super_admin = true
     order by created_at asc
     limit 1;
  end if;

  -- Insert version row
  insert into public.survey_versions (survey_id, version, published_by)
  values (v_survey_id, v_version, v_publisher)
  returning id into v_sv_id;

  -- Insert questions in order
  for v_q in select * from jsonb_array_elements(p_questions)
  loop
    v_i := v_i + 1;
    insert into public.survey_questions (
      survey_version_id,
      sort_order,
      short_label_he,
      prompt_he,
      context_he,
      text_placeholder_he,
      rating_anchor_low_he,
      rating_anchor_high_he
    ) values (
      v_sv_id,
      v_i,
      v_q->>'short_label_he',
      v_q->>'prompt_he',
      coalesce(v_q->>'context_he', ''),
      coalesce(v_q->>'text_placeholder_he', ''),
      coalesce(v_q->>'rating_anchor_low_he',  'לא מספיק'),
      coalesce(v_q->>'rating_anchor_high_he', 'מצוין')
    );
  end loop;

  return json_build_object(
    'slug',    p_slug,
    'version', v_version,
    'questions_count', v_i
  );
end;
$$;

revoke all on function public.publish_survey_version(text, text, text, boolean, jsonb, jsonb) from public, anon;
grant execute on function public.publish_survey_version(text, text, text, boolean, jsonb, jsonb) to authenticated;

comment on function public.publish_survey_version(text, text, text, boolean, jsonb, jsonb) is
  'Super-admin only. Creates or updates a survey and publishes a new version with the supplied questions. FR-SETTINGS-016 AC7.';

-- ---------------------------------------------------------------------------
-- RPC: check_survey_prompt_eligibility(p_slug text, p_session_count int)
-- Returns { show: boolean, reasons: text[] }
-- V1: client-passes session count (spoofable; affects banner UX only, not
-- security). TD-FE: replace with server-side user_app_sessions table.
-- ---------------------------------------------------------------------------

create or replace function public.check_survey_prompt_eligibility(
  p_slug          text,
  p_session_count int
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid                 uuid := auth.uid();
  v_survey_id           uuid;
  v_version             int;
  v_prompt_rules        jsonb;
  v_sv_id               uuid;
  v_q_total             int;
  v_ans_count           int;
  v_min_sessions        int;
  v_require_closure     boolean;
  v_require_profile     boolean;
  v_reasons             text[] := '{}';
  v_show                boolean := true;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Resolve active survey
  select id, current_version, prompt_rules
    into v_survey_id, v_version, v_prompt_rules
    from public.surveys
   where slug = p_slug
     and is_active = true
     and current_version > 0;

  if v_survey_id is null then
    return json_build_object('show', false, 'reasons', array['survey_inactive_or_not_found']);
  end if;

  -- Check survey not already completed
  select id into v_sv_id
    from public.survey_versions
   where survey_id = v_survey_id and version = v_version;

  select count(*)::int into v_q_total
    from public.survey_questions
   where survey_version_id = v_sv_id;

  select count(*)::int into v_ans_count
    from public.survey_answers
   where user_id   = v_uid
     and survey_id = v_survey_id
     and version   = v_version;

  if v_q_total > 0 and v_ans_count >= v_q_total then
    v_show := false;
    v_reasons := array_append(v_reasons, 'already_completed');
  end if;

  -- min_sessions gate (V1: client-passed, spoofable — see TD note above)
  v_min_sessions := (v_prompt_rules->>'min_sessions')::int;
  if v_min_sessions is not null and p_session_count < v_min_sessions then
    v_show := false;
    v_reasons := array_append(v_reasons, 'session_count_below_threshold');
  end if;

  -- require_closure: user must have at least one closed_delivered post
  v_require_closure := (v_prompt_rules->>'require_closure')::boolean;
  if v_require_closure = true then
    if not exists (
      select 1 from public.posts
       where user_id = v_uid
         and status  = 'closed_delivered'
    ) then
      v_show := false;
      v_reasons := array_append(v_reasons, 'no_closed_delivered_post');
    end if;
  end if;

  -- require_profile_complete: display_name set + at least one post of any status
  v_require_profile := (v_prompt_rules->>'require_profile_complete')::boolean;
  if v_require_profile = true then
    if not exists (
      select 1 from public.users
       where user_id      = v_uid
         and display_name is not null
         and display_name <> ''
    ) then
      v_show := false;
      v_reasons := array_append(v_reasons, 'profile_incomplete_display_name');
    end if;

    if not exists (
      select 1 from public.posts
       where user_id = v_uid
         and status not in ('removed_admin')
       limit 1
    ) then
      v_show := false;
      v_reasons := array_append(v_reasons, 'profile_incomplete_no_post');
    end if;
  end if;

  if v_show and cardinality(v_reasons) = 0 then
    v_reasons := array['eligible'];
  end if;

  return json_build_object('show', v_show, 'reasons', v_reasons);
end;
$$;

revoke all on function public.check_survey_prompt_eligibility(text, int) from public, anon;
grant execute on function public.check_survey_prompt_eligibility(text, int) to authenticated;

comment on function public.check_survey_prompt_eligibility(text, int) is
  'Returns {show, reasons} for the milestone prompt banner. V1 uses client-supplied session count (spoofable; affects UX only). FR-SETTINGS-016 AC6.';

-- ---------------------------------------------------------------------------
-- Seed: Survey A "ux-experience" v1 — 6 questions from design spec §8
-- Executed at migration-apply time via the publish_survey_version RPC.
-- If no super-admin user exists yet (fresh CI stack), the seed is skipped
-- gracefully; operators can re-run via Supabase Studio.
-- ---------------------------------------------------------------------------

do $$
declare
  v_admin uuid;
  v_result json;
begin
  select user_id into v_admin
    from public.users
   where is_super_admin = true
   order by created_at asc
   limit 1;

  if v_admin is null then
    raise notice 'no super-admin found; skipping ux-experience v1 seed. Run publish_survey_version manually after provisioning a super-admin.';
    return;
  end if;

  -- publish_survey_version handles upsert of survey row + version + questions atomically.
  -- Running as postgres (no JWT) so the auth.uid() null-path inside the RPC uses
  -- v_admin as published_by.
  select public.publish_survey_version(
    'ux-experience',
    'סקר חווית משתמש',
    'שאלות קצרות שעוזרות לנו לשפר את קארמה',
    true,
    '{"min_sessions": 3, "require_closure": true, "require_profile_complete": true}'::jsonb,
    $q$[
      {
        "short_label_he": "המלצה",
        "prompt_he": "השבוע הקרוב — מה הסיכוי שתספר/י על קארמה למישהו/י?",
        "context_he": "",
        "text_placeholder_he": "מה הכי משכנע אותך לספר — או הכי מונע ממך?",
        "rating_anchor_low_he": "אפס סיכוי",
        "rating_anchor_high_he": "כבר סיפרתי השבוע"
      },
      {
        "short_label_he": "חוויה אחרונה",
        "prompt_he": "הפעם האחרונה שניסית לתת או לבקש בקארמה — איך הייתה החוויה?",
        "context_he": "",
        "text_placeholder_he": "תספר/י מה קרה — מהפתיחה ועד שיצאת",
        "rating_anchor_low_he": "מעצבן",
        "rating_anchor_high_he": "זרם"
      },
      {
        "short_label_he": "סיפור בפועל",
        "prompt_he": "ב-3 השבועות האחרונים — לכמה אנשים סיפרת על קארמה בפועל?",
        "context_he": "",
        "text_placeholder_he": "מי היו, ומה אמרת להם?",
        "rating_anchor_low_he": "אף אחד",
        "rating_anchor_high_he": "ל-5+ אנשים"
      },
      {
        "short_label_he": "כמעט מחיקה",
        "prompt_he": "עד כמה היית קרוב/ה למחוק את האפליקציה החודש?",
        "context_he": "",
        "text_placeholder_he": "מה היה כמעט הקש האחרון? (גם דברים קטנים)",
        "rating_anchor_low_he": "אף פעם לא חשבתי",
        "rating_anchor_high_he": "ידי הייתה על הכפתור"
      },
      {
        "short_label_he": "בחירה",
        "prompt_he": "בפעם האחרונה שרצית לתת — באיזו פלטפורמה בחרת לפרסם?",
        "context_he": "",
        "text_placeholder_he": "למה בחרת בזו ולא בשנייה?",
        "rating_anchor_low_he": "תמיד ווטסאפ/פייסבוק",
        "rating_anchor_high_he": "תמיד קארמה"
      },
      {
        "short_label_he": "חסם",
        "prompt_he": "עד כמה היה לך קל להגיע מרעיון לפעולה השבוע?",
        "context_he": "",
        "text_placeholder_he": "מה הדבר האחרון שעצר או האט אותך השבוע?",
        "rating_anchor_low_he": "קשה, מתיש",
        "rating_anchor_high_he": "פשוט וקל"
      }
    ]$q$::jsonb
  ) into v_result;

  raise notice 'ux-experience v1 seeded: %', v_result;
end;
$$;

commit;
