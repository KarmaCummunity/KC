-- 0458_admin_pmf_survey_report | KC#1058 — Sean Ellis PMF survey, part 3 (admin).
--
-- 1. `admin_pmf_survey_report(p_slug)`: per option of the survey's single-choice question,
--    counts among *qualified* respondents — users active on at least `min_active_days_14d`
--    (default 2) distinct days in the 14 days ending on the day they answered — plus a
--    retention cross-check: of those who answered ≥ 7 days ago, how many came back on a
--    day ≥ 7 days after answering. Counts only; the share and margin of error are derived
--    in the domain (`summarizePmfSurvey`).
-- 2. `admin_survey_results`: body of 0201 plus `question_type`, `choice_counts` and the
--    respondents' `choice_key`, so a single-choice question reads correctly in the
--    generic results view.
--
-- Mapped to spec: FR-ADMIN-021 (AC, PMF report). Read-only. Idempotent.

-- ---------------------------------------------------------------------------
-- 1. PMF report
-- ---------------------------------------------------------------------------

create or replace function public.admin_pmf_survey_report(p_slug text default 'pmf-sean-ellis')
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_today      date := (now() at time zone 'Asia/Jerusalem')::date;
  v_survey_id  uuid;
  v_version    int;
  v_title_he   text;
  v_min_days   int;
  v_sv_id      uuid;
  v_q          public.survey_questions;
  v_result     json;
begin
  perform public.admin_assert_role(v_uid, array['super_admin', 'moderator']);

  select id, current_version, title_he,
         coalesce((prompt_rules->>'min_active_days_14d')::int, 2)
    into v_survey_id, v_version, v_title_he, v_min_days
    from public.surveys
   where slug = p_slug;

  if v_survey_id is null then
    raise exception 'survey_not_found' using errcode = '22023';
  end if;

  select id into v_sv_id
    from public.survey_versions
   where survey_id = v_survey_id and version = v_version;

  -- The report reads the first single-choice question of the current version.
  select * into v_q
    from public.survey_questions
   where survey_version_id = v_sv_id
     and question_type = 'single_choice_with_optional_text'
   order by sort_order
   limit 1;

  if v_q.id is null then
    raise exception 'survey_has_no_choice_question' using errcode = '22023';
  end if;

  with answered as (
    -- First answer day per respondent (a later change of choice keeps that day).
    select a.user_id, a.choice_key, (a.created_at at time zone 'Asia/Jerusalem')::date as answered_on
      from public.survey_answers a
     where a.question_id = v_q.id
       and a.choice_key is not null
  ),
  scored as (
    select an.choice_key,
           public.user_active_days_14d(an.user_id, an.answered_on) >= v_min_days as qualified,
           an.answered_on <= v_today - 7 as retention_measurable,
           exists (
             select 1 from public.user_active_days d
              where d.user_id = an.user_id and d.active_on >= an.answered_on + 7
           ) as retained
      from answered an
  )
  select json_build_object(
    'slug',                 p_slug,
    'title_he',             v_title_he,
    'version',              v_version,
    'question_id',          v_q.id,
    'prompt_he',            v_q.prompt_he,
    'min_active_days_14d',  v_min_days,
    'respondents_total',    (select count(*)::int from scored),
    'respondents_qualified', (select count(*)::int from scored where qualified),
    'options', (
      select json_agg(json_build_object(
        'key',            o.opt->>'key',
        'label_he',       o.opt->>'label_he',
        'count',          (select count(*)::int from scored s
                            where s.qualified and s.choice_key = o.opt->>'key'),
        'retention_base', (select count(*)::int from scored s
                            where s.qualified and s.retention_measurable and s.choice_key = o.opt->>'key'),
        'retained',       (select count(*)::int from scored s
                            where s.qualified and s.retention_measurable and s.retained
                              and s.choice_key = o.opt->>'key')
      ) order by o.ord)
      from jsonb_array_elements(v_q.choice_options) with ordinality as o(opt, ord)
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_pmf_survey_report(text) from public, anon;
grant execute on function public.admin_pmf_survey_report(text) to authenticated;

comment on function public.admin_pmf_survey_report(text) is
  'Admin-only (super_admin|moderator). Sean Ellis PMF counts among respondents active ≥ N days in the 14 days before answering, with a 7-day retention cross-check per option. FR-ADMIN-021, KC#1058.';

-- ---------------------------------------------------------------------------
-- 2. Generic results with single-choice questions
-- ---------------------------------------------------------------------------

create or replace function public.admin_survey_results(p_slug text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_survey_id   uuid;
  v_version     int;
  v_title_he    text;
  v_sv_id       uuid;
  v_questions   json;
  v_respondents json;
  v_count       int;
begin
  perform public.admin_assert_role(v_uid, array['super_admin', 'moderator']);

  select id, current_version, title_he
    into v_survey_id, v_version, v_title_he
    from public.surveys
   where slug = p_slug;

  if v_survey_id is null then
    raise exception 'survey_not_found' using errcode = '22023';
  end if;

  select id into v_sv_id
    from public.survey_versions
   where survey_id = v_survey_id and version = v_version;

  -- Per-question statistics; rating fields stay empty for single-choice questions.
  select json_agg(
    json_build_object(
      'id',                    q.id,
      'sort_order',            q.sort_order,
      'question_type',         q.question_type,
      'short_label_he',        q.short_label_he,
      'prompt_he',             q.prompt_he,
      'rating_anchor_low_he',  q.rating_anchor_low_he,
      'rating_anchor_high_he', q.rating_anchor_high_he,
      'response_count',        coalesce(st.cnt, 0),
      'avg_rating',            st.avg_rating,
      'distribution',          coalesce(st.distribution, json_build_array(0,0,0,0,0,0,0)),
      'choice_counts',         coalesce((
        select json_agg(json_build_object(
          'key',      o.opt->>'key',
          'label_he', o.opt->>'label_he',
          'count',    (select count(*)::int from public.survey_answers a
                        where a.question_id = q.id and a.choice_key = o.opt->>'key')
        ) order by o.ord)
        from jsonb_array_elements(q.choice_options) with ordinality as o(opt, ord)
      ), '[]'::json)
    )
    order by q.sort_order
  )
  into v_questions
  from public.survey_questions q
  left join lateral (
    select
      count(*)::int as cnt,
      round(avg(a.rating)::numeric, 2) as avg_rating,
      json_build_array(
        count(*) filter (where a.rating = 1),
        count(*) filter (where a.rating = 2),
        count(*) filter (where a.rating = 3),
        count(*) filter (where a.rating = 4),
        count(*) filter (where a.rating = 5),
        count(*) filter (where a.rating = 6),
        count(*) filter (where a.rating = 7)
      ) as distribution
    from public.survey_answers a
    where a.question_id = q.id
      and a.survey_id   = v_survey_id
      and a.version     = v_version
  ) st on true
  where q.survey_version_id = v_sv_id;

  -- Per-respondent answers (most recent submission first).
  select json_agg(sub.payload order by sub.submitted_at desc)
  into v_respondents
  from (
    select
      a.user_id,
      max(a.updated_at) as submitted_at,
      json_build_object(
        'user_id',      a.user_id,
        'display_name', u.display_name,
        'submitted_at', max(a.updated_at),
        'answers', json_agg(
          json_build_object(
            'question_id', a.question_id,
            'rating',      a.rating,
            'choice_key',  a.choice_key,
            'answer_text', a.answer_text
          ) order by q.sort_order
        )
      ) as payload
    from public.survey_answers a
    join public.survey_questions q on q.id = a.question_id
    left join public.users u on u.user_id = a.user_id
    where a.survey_id = v_survey_id
      and a.version   = v_version
    group by a.user_id, u.display_name
  ) sub;

  select count(distinct a.user_id)::int
    into v_count
    from public.survey_answers a
   where a.survey_id = v_survey_id and a.version = v_version;

  return json_build_object(
    'slug',             p_slug,
    'title_he',         v_title_he,
    'version',          v_version,
    'respondent_count', coalesce(v_count, 0),
    'questions',        coalesce(v_questions, '[]'::json),
    'respondents',      coalesce(v_respondents, '[]'::json)
  );
end;
$$;

revoke all on function public.admin_survey_results(text) from public, anon;
grant execute on function public.admin_survey_results(text) to authenticated;
