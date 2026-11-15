-- 0201_admin_survey_results.sql
-- FR-ADMIN-021 — Admin Portal: Survey results & free-feedback dashboard.
-- Adds three read-only, security-definer RPCs gated to super_admin / moderator
-- so the portal can surface aggregate statistics AND per-user answers for the
-- server-driven surveys (FR-SETTINGS-015..017) plus the free-text feedback
-- (FR-SETTINGS-017). No schema/table changes — pure read aggregation over the
-- existing surveys / survey_answers / user_feedback tables.
--
-- Authorization: every function calls admin_assert_role(auth.uid(),
-- ARRAY['super_admin','moderator']) which raises SQLSTATE 42501 otherwise.

begin;

-- ---------------------------------------------------------------------------
-- RPC: admin_survey_overview()
-- One row per published survey (current_version > 0) with response counts.
-- ---------------------------------------------------------------------------

create or replace function public.admin_survey_overview()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_rows json;
begin
  perform public.admin_assert_role(v_uid, ARRAY['super_admin','moderator']);

  select json_agg(
    json_build_object(
      'slug',             s.slug,
      'title_he',         s.title_he,
      'description_he',   s.description_he,
      'is_active',        s.is_active,
      'current_version',  s.current_version,
      'question_count',   qc.cnt,
      'respondent_count', coalesce(rc.cnt, 0),
      'response_total',   coalesce(rt.cnt, 0),
      'last_response_at',  rt.last_at
    )
    order by s.created_at asc
  )
  into v_rows
  from public.surveys s
  join public.survey_versions sv
    on sv.survey_id = s.id
   and sv.version   = s.current_version
  join lateral (
    select count(*)::int as cnt
      from public.survey_questions q
     where q.survey_version_id = sv.id
  ) qc on true
  left join lateral (
    select count(distinct a.user_id)::int as cnt
      from public.survey_answers a
     where a.survey_id = s.id and a.version = s.current_version
  ) rc on true
  left join lateral (
    select count(*)::int as cnt, max(a.updated_at) as last_at
      from public.survey_answers a
     where a.survey_id = s.id and a.version = s.current_version
  ) rt on true
  where s.current_version > 0;

  return coalesce(v_rows, '[]'::json);
end;
$$;

revoke all on function public.admin_survey_overview() from public, anon;
grant execute on function public.admin_survey_overview() to authenticated;

comment on function public.admin_survey_overview() is
  'Admin-only (super_admin|moderator). Lists published surveys with response/respondent counts. FR-ADMIN-021.';

-- ---------------------------------------------------------------------------
-- RPC: admin_survey_results(p_slug text)
-- Per-question aggregate statistics (count, avg, 1..7 distribution) for the
-- survey's current version, plus the full per-respondent answer breakdown.
-- ---------------------------------------------------------------------------

create or replace function public.admin_survey_results(p_slug text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_survey_id  uuid;
  v_version    int;
  v_title_he   text;
  v_sv_id      uuid;
  v_questions  json;
  v_respondents json;
  v_count      int;
begin
  perform public.admin_assert_role(v_uid, ARRAY['super_admin','moderator']);

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

  -- Per-question statistics
  select json_agg(
    json_build_object(
      'id',                    q.id,
      'sort_order',            q.sort_order,
      'short_label_he',        q.short_label_he,
      'prompt_he',             q.prompt_he,
      'rating_anchor_low_he',  q.rating_anchor_low_he,
      'rating_anchor_high_he', q.rating_anchor_high_he,
      'response_count',        coalesce(st.cnt, 0),
      'avg_rating',            st.avg_rating,
      'distribution',          coalesce(st.distribution,
                                 json_build_array(0,0,0,0,0,0,0))
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

  -- Per-respondent answers (most recent submission first)
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

comment on function public.admin_survey_results(text) is
  'Admin-only (super_admin|moderator). Returns per-question stats + per-user answers for a survey current version. FR-ADMIN-021.';

-- ---------------------------------------------------------------------------
-- RPC: admin_user_feedback_list(p_limit int, p_offset int)
-- Paginated free-text feedback (user_feedback) with submitter display name.
-- ---------------------------------------------------------------------------

create or replace function public.admin_user_feedback_list(
  p_limit  int default 50,
  p_offset int default 0
)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_off int := greatest(coalesce(p_offset, 0), 0);
  v_rows json;
begin
  perform public.admin_assert_role(v_uid, ARRAY['super_admin','moderator']);

  select json_agg(
    json_build_object(
      'id',           f.id,
      'user_id',      f.user_id,
      'display_name', u.display_name,
      'rating',       f.rating,
      'body',         f.body,
      'created_at',   f.created_at
    )
    order by f.created_at desc
  )
  into v_rows
  from (
    select *
      from public.user_feedback
     order by created_at desc
     limit v_lim offset v_off
  ) f
  left join public.users u on u.user_id = f.user_id;

  return coalesce(v_rows, '[]'::json);
end;
$$;

revoke all on function public.admin_user_feedback_list(int, int) from public, anon;
grant execute on function public.admin_user_feedback_list(int, int) to authenticated;

comment on function public.admin_user_feedback_list(int, int) is
  'Admin-only (super_admin|moderator). Paginated free-text feedback with submitter display name. FR-ADMIN-021.';

commit;
