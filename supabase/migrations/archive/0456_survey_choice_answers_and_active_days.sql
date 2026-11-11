-- 0456_survey_choice_answers_and_active_days | KC#1058 — Sean Ellis PMF survey, part 1.
--
-- 1. Single-choice questions: `survey_questions.choice_options` and
--    `survey_answers.choice_key`. An answer holds exactly one of rating / choice_key.
-- 2. `user_active_days`: one row per user per Israel calendar day the app was opened
--    while signed in (`rpc_record_active_day`). Server-side activity, which the PMF
--    eligibility rule ("used KC at least twice in the last 2 weeks") and the
--    retention cross-check need. It is not readable by clients.
-- 3. `get_survey_bundle` / `upsert_survey_answers` return and accept choice answers.
--
-- Mapped to spec: FR-SETTINGS-016 (AC8, new), FR-ADMIN-021 (AC, PMF report). Idempotent.

-- ---------------------------------------------------------------------------
-- 1. Single-choice schema
-- ---------------------------------------------------------------------------

-- Options of a single-choice question: [{ "key": "very_disappointed", "label_he": "..." }].
alter table public.survey_questions
  add column if not exists choice_options jsonb null;

alter table public.survey_questions
  drop constraint if exists survey_questions_choice_options_shape;
-- Rating questions carry no options; single-choice questions carry 2..6 of them.
alter table public.survey_questions
  add constraint survey_questions_choice_options_shape check (
    case question_type
      when 'single_choice_with_optional_text' then
        choice_options is not null
        and jsonb_typeof(choice_options) = 'array'
        and jsonb_array_length(choice_options) between 2 and 6
      else choice_options is null
    end
  );

comment on column public.survey_questions.choice_options is
  'Single-choice questions only: ordered [{key, label_he}] options. NULL for rating questions. KC#1058.';

-- A choice answer has no rating, so the rating becomes optional.
alter table public.survey_answers
  alter column rating drop not null;

alter table public.survey_answers
  add column if not exists choice_key text null;

alter table public.survey_answers
  drop constraint if exists survey_answers_one_value;
-- Exactly one of rating / choice_key per answer row.
alter table public.survey_answers
  add constraint survey_answers_one_value check (
    num_nonnulls(rating, choice_key) = 1
    and (choice_key is null or char_length(choice_key) between 1 and 64)
  );

comment on column public.survey_answers.choice_key is
  'Single-choice answer: the chosen option key from survey_questions.choice_options. KC#1058.';

-- ---------------------------------------------------------------------------
-- 2. Active days
-- ---------------------------------------------------------------------------

create table if not exists public.user_active_days (
  user_id   uuid not null references public.users(user_id) on delete cascade,
  active_on date not null,
  primary key (user_id, active_on)
);

comment on table public.user_active_days is
  'One row per user per Asia/Jerusalem calendar day with a signed-in app open (rpc_record_active_day). Server-only; feeds survey eligibility and retention. KC#1058.';

alter table public.user_active_days enable row level security;
revoke all on table public.user_active_days from public, anon, authenticated;

-- Only SECURITY DEFINER functions read or write this table; the explicit client deny
-- also satisfies supabase/tests/rls-lint.sql (every RLS table needs ≥ 1 policy).
drop policy if exists user_active_days_deny_clients on public.user_active_days;
create policy user_active_days_deny_clients
  on public.user_active_days
  for all
  to authenticated, anon
  using (false)
  with check (false);

-- Records today's active day for the caller. Idempotent (one row per day).
create or replace function public.rpc_record_active_day()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Skips callers without a profile row yet (mid-onboarding) instead of failing the FK.
  insert into public.user_active_days (user_id, active_on)
  select v_uid, (now() at time zone 'Asia/Jerusalem')::date
   where exists (select 1 from public.users u where u.user_id = v_uid)
  on conflict (user_id, active_on) do nothing;
end;
$$;

revoke all on function public.rpc_record_active_day() from public, anon;
grant execute on function public.rpc_record_active_day() to authenticated;

comment on function public.rpc_record_active_day() is
  'Marks the caller active today (Asia/Jerusalem). Called once per day on app open. KC#1058.';

-- Distinct active days of a user in the 14 days ending on p_day (inclusive).
create or replace function public.user_active_days_14d(p_user_id uuid, p_day date)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from public.user_active_days d
   where d.user_id = p_user_id
     and d.active_on between p_day - 13 and p_day;
$$;

revoke all on function public.user_active_days_14d(uuid, date) from public, anon, authenticated;

comment on function public.user_active_days_14d(uuid, date) is
  'Internal: distinct active days in the 14 days ending on p_day. Used by survey eligibility and the PMF report. KC#1058.';

-- Keep 400 days of activity (enough for a year-over-year retention look).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'purge_user_active_days') then
      perform cron.unschedule('purge_user_active_days');
    end if;
    perform cron.schedule(
      'purge_user_active_days',
      '23 3 * * *',
      $cmd$delete from public.user_active_days where active_on < current_date - 400$cmd$
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Bundle + upsert with choice answers
-- ---------------------------------------------------------------------------

-- Same as 0130 plus `choice_options` on questions and `choice_key` on answers.
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

  select id, current_version, title_he, description_he
    into v_survey_id, v_version, v_title_he, v_desc_he
    from public.surveys
   where slug = p_slug
     and is_active = true
     and current_version > 0;

  if v_survey_id is null then
    raise exception 'survey_not_found' using errcode = '22023';
  end if;

  select id into v_sv_id
    from public.survey_versions
   where survey_id = v_survey_id and version = v_version;

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
      'rating_anchor_high_he', q.rating_anchor_high_he,
      'choice_options',        coalesce(q.choice_options, '[]'::jsonb)
    ) order by q.sort_order
  )
  into v_questions
  from public.survey_questions q
  where q.survey_version_id = v_sv_id;

  select json_agg(
    json_build_object(
      'question_id',  a.question_id,
      'rating',       a.rating,
      'choice_key',   a.choice_key,
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

-- p_answers: [{ "question_id": uuid, "rating": 1..7 | null, "choice_key": text | null, "answer_text": text }]
-- A rating question takes a rating; a single-choice question takes one of its option keys.
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
  v_choice    text;
  v_text      text;
  v_q         public.survey_questions;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select id, current_version
    into v_survey_id, v_version
    from public.surveys
   where slug = p_slug
     and is_active = true
     and current_version > 0;

  if v_survey_id is null then
    raise exception 'survey_not_found_or_inactive' using errcode = '22023';
  end if;

  select id into v_sv_id
    from public.survey_versions
   where survey_id = v_survey_id and version = v_version;

  for v_answer in select * from jsonb_array_elements(p_answers)
  loop
    v_qid    := (v_answer->>'question_id')::uuid;
    v_rating := (v_answer->>'rating')::int;
    v_choice := v_answer->>'choice_key';
    v_text   := v_answer->>'answer_text';

    select * into v_q
      from public.survey_questions
     where id = v_qid and survey_version_id = v_sv_id;
    if v_q.id is null then
      raise exception 'question_not_in_current_version: %', v_qid using errcode = '22023';
    end if;

    if v_q.question_type = 'single_choice_with_optional_text' then
      -- The key must be one of the question's options, and no rating is allowed.
      if v_rating is not null or v_choice is null or not exists (
        select 1 from jsonb_array_elements(v_q.choice_options) o where o->>'key' = v_choice
      ) then
        raise exception 'invalid_choice for question %', v_qid using errcode = '22023';
      end if;
    elsif v_choice is not null or v_rating is null or v_rating < 1 or v_rating > 7 then
      raise exception 'invalid_rating for question %', v_qid using errcode = '22023';
    end if;

    if v_text is not null and char_length(v_text) > 500 then
      raise exception 'answer_text_too_long for question %', v_qid using errcode = '22023';
    end if;

    insert into public.survey_answers
      (user_id, survey_id, version, question_id, rating, choice_key, answer_text)
    values
      (v_uid, v_survey_id, v_version, v_qid, v_rating, v_choice, v_text)
    on conflict (user_id, survey_id, version, question_id)
    do update set
      rating      = excluded.rating,
      choice_key  = excluded.choice_key,
      answer_text = excluded.answer_text,
      updated_at  = now();
  end loop;
end;
$$;

-- `create or replace` keeps the 0130 grants; re-asserted so this file stands alone.
revoke all on function public.get_survey_bundle(text) from public, anon;
grant execute on function public.get_survey_bundle(text) to authenticated;
revoke all on function public.upsert_survey_answers(text, jsonb) from public, anon;
grant execute on function public.upsert_survey_answers(text, jsonb) to authenticated;
