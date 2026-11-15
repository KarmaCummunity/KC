-- Research · free feedback and the staff survey reports (FR-SETTINGS-017, FR-ADMIN-021)
--
-- Two additions to the research module: the free feedback form of Settings with its staff
-- list, and the survey dashboard reads (published surveys, per-question statistics,
-- respondents' answers and the product-market fit card).

-- Research · free feedback (FR-SETTINGS-017, FR-ADMIN-021 AC5)
--
-- Settings → "Free feedback": an optional 1–7 rating and a short text, sent by a signed-in
-- member and read by staff on the admin survey dashboard. A member inserts their own row
-- and never reads it back; staff read the list, newest first, through one RPC that adds the
-- sender's display name.

create table public.user_feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  rating     integer check (rating between 1 and 7),
  body       text not null check (char_length(btrim(body)) between 10 and 500),
  created_at timestamptz not null default now()
);
comment on table public.user_feedback is 'Free feedback from Settings: optional 1-7 rating and text. Read by staff only.';

-- Staff list, newest first, keyset on (created_at, id).
create index user_feedback_recent_idx on public.user_feedback (created_at desc, id desc);
-- Covers the member foreign key (account removal).
create index user_feedback_user_idx on public.user_feedback (user_id);

alter table public.user_feedback enable row level security;
alter table public.user_feedback force row level security;

-- An active member files feedback as themselves. There is no select policy: the list is
-- staff-only and served by admin_user_feedback_list().
create policy user_feedback_insert_own on public.user_feedback
  for insert to authenticated
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.users u where u.id = (select auth.uid()) and u.is_active));

grant insert (user_id, rating, body) on public.user_feedback to authenticated;

-- One keyset page of free feedback for the admin dashboard, newest first, with the sender's
-- display name (FR-ADMIN-021 AC5). Moderators and more senior staff only (AC1, AC6). Pass
-- the last row's next_cursor to continue.
--   forbidden (42501)
create function public.admin_user_feedback_list(p_limit integer default 50, p_cursor jsonb default null)
returns table (
  id uuid, user_id uuid, display_name text, rating integer, body text, created_at timestamptz,
  next_cursor jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit constant integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_t constant timestamptz := (p_cursor ->> 't')::timestamptz;
  v_id constant uuid := (p_cursor ->> 'id')::uuid;
begin
  perform kc_private.require_admin_role('moderator');
  return query
  select f.id, f.user_id, u.display_name, f.rating, f.body, f.created_at,
         jsonb_build_object('t', f.created_at, 'id', f.id)
    from public.user_feedback f
    join public.users u on u.id = f.user_id
   where p_cursor is null or (f.created_at, f.id) < (v_t, v_id)
   order by f.created_at desc, f.id desc
   limit v_limit;
end;
$$;
comment on function public.admin_user_feedback_list(integer, jsonb) is
  'Staff: one keyset page of free feedback, newest first, with the sender''s display name.';
grant execute on function public.admin_user_feedback_list(integer, jsonb) to authenticated;

-- Research · survey reports for staff (FR-ADMIN-021)
--
-- The admin survey dashboard: published surveys with their counts, per-question statistics
-- and every respondent's answers for the current version, and the Sean Ellis product-market
-- fit card. Answers are private to their author and the super admin (survey_answers
-- policies), so these reads run with definer rights and admit moderators and more senior
-- staff only (FR-ADMIN-021 AC1, AC6). They return the JSON documents the app maps.

-- Statistics of one question over all its answers: count, average and 1–7 distribution for a
-- rating question, count per option for a single-choice question (FR-ADMIN-021 AC3, AC7).
create function kc_private.survey_question_stats(p_question public.survey_questions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
           'id', p_question.id, 'sort_order', p_question.sort_order,
           'question_type', p_question.question_type, 'short_label_he', p_question.short_label_he,
           'prompt_he', p_question.prompt_he, 'rating_anchor_low_he', p_question.rating_anchor_low_he,
           'rating_anchor_high_he', p_question.rating_anchor_high_he,
           'response_count', count(*), 'avg_rating', round(avg(a.rating), 2),
           'distribution', jsonb_build_array(
             count(*) filter (where a.rating = 1), count(*) filter (where a.rating = 2),
             count(*) filter (where a.rating = 3), count(*) filter (where a.rating = 4),
             count(*) filter (where a.rating = 5), count(*) filter (where a.rating = 6),
             count(*) filter (where a.rating = 7)),
           'choice_counts', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'key', o.opt ->> 'key', 'label_he', o.opt ->> 'label_he',
                      'count', (select count(*) from public.survey_answers c
                                 where c.question_id = p_question.id and c.choice_key = o.opt ->> 'key'))
                    order by o.ord)
               from jsonb_array_elements(p_question.choice_options) with ordinality as o (opt, ord)),
             '[]'::jsonb))
    from public.survey_answers a
   where a.question_id = p_question.id;
$$;
comment on function kc_private.survey_question_stats(public.survey_questions) is
  'Answer statistics of one survey question, as the admin results screen shows them.';

-- Every published survey (retired ones too) with the counts of its current version, oldest
-- survey first (FR-ADMIN-021 AC2).
--   forbidden (42501)
create function public.admin_survey_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.require_admin_role('moderator');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'slug', s.slug, 'title_he', s.title_he, 'description_he', s.description_he,
             'is_active', s.is_active, 'current_version', s.current_version,
             'question_count', st.question_count, 'respondent_count', st.respondent_count,
             'response_total', st.response_total, 'last_response_at', st.last_response_at)
           order by s.created_at, s.id)
      from public.surveys s
      join public.survey_versions v on v.survey_id = s.id and v.version = s.current_version
     cross join lateral (
       select count(distinct q.id) as question_count, count(distinct a.user_id) as respondent_count,
              count(a.question_id) as response_total, max(a.updated_at) as last_response_at
         from public.survey_questions q
         left join public.survey_answers a on a.question_id = q.id
        where q.survey_version_id = v.id) st),
    '[]'::jsonb);
end;
$$;
comment on function public.admin_survey_overview() is
  'Staff: published surveys with question, respondent and answer counts of the current version.';
grant execute on function public.admin_survey_overview() to authenticated;

-- Results of a survey's current version: per-question statistics and each respondent's
-- answers, most recent first (FR-ADMIN-021 AC3, AC4, AC7). Respondents are bounded to the
-- 1000 most recent; respondent_count is the full number.
--   forbidden (42501) · survey_not_found (no published survey with this slug)
create function public.admin_survey_results(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_survey public.surveys;
  v_version_id uuid;
begin
  perform kc_private.require_admin_role('moderator');
  select s.* into v_survey from public.surveys s where s.slug = p_slug and s.current_version > 0;
  if not found then
    raise exception 'survey_not_found' using errcode = 'P0001';
  end if;
  select v.id into v_version_id
    from public.survey_versions v
   where v.survey_id = v_survey.id and v.version = v_survey.current_version;

  return jsonb_build_object(
    'slug', v_survey.slug, 'title_he', v_survey.title_he, 'version', v_survey.current_version,
    'respondent_count', (
      select count(distinct a.user_id)
        from public.survey_answers a
        join public.survey_questions q on q.id = a.question_id
       where q.survey_version_id = v_version_id),
    'questions', coalesce((
      select jsonb_agg(kc_private.survey_question_stats(q) order by q.sort_order)
        from public.survey_questions q
       where q.survey_version_id = v_version_id), '[]'::jsonb),
    'respondents', coalesce((
      select jsonb_agg(r.payload order by r.submitted_at desc, r.user_id)
        from (select a.user_id, max(a.updated_at) as submitted_at,
                     jsonb_build_object(
                       'user_id', a.user_id, 'display_name', u.display_name,
                       'submitted_at', max(a.updated_at),
                       'answers', jsonb_agg(jsonb_build_object(
                                    'question_id', a.question_id, 'rating', a.rating,
                                    'choice_key', a.choice_key, 'answer_text', a.answer_text)
                                  order by q.sort_order)) as payload
                from public.survey_answers a
                join public.survey_questions q on q.id = a.question_id
                join public.users u on u.id = a.user_id
               where q.survey_version_id = v_version_id
               group by a.user_id, u.display_name
               order by max(a.updated_at) desc, a.user_id
               limit 1000) r), '[]'::jsonb));
end;
$$;
comment on function public.admin_survey_results(text) is
  'Staff: per-question statistics and respondents'' answers of a survey''s current version.';
grant execute on function public.admin_survey_results(text) to authenticated;

-- Sean Ellis product-market fit counts (FR-ADMIN-021 AC8), over the first single-choice
-- question of the survey's current version. A respondent is qualified when active on at
-- least `prompt_rules.min_active_days_14d` (default 2) days in the 14 Israel days ending on
-- the day they first answered. Per option: qualified answers, those answered at least 7 days
-- ago (retention_base), and of those, the ones active again 7 or more days after answering
-- (retained). Counts only; the share and its margin of error are derived in the app.
--   forbidden (42501) · survey_not_found · survey_has_no_choice_question
create function public.admin_pmf_survey_report(p_slug text default 'pmf-sean-ellis')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today constant date := (now() at time zone 'Asia/Jerusalem')::date;
  v_survey public.surveys;
  v_question public.survey_questions;
  v_min_days integer;
begin
  perform kc_private.require_admin_role('moderator');
  select s.* into v_survey from public.surveys s where s.slug = p_slug and s.current_version > 0;
  if not found then
    raise exception 'survey_not_found' using errcode = 'P0001';
  end if;
  select q.* into v_question
    from public.survey_questions q
    join public.survey_versions v on v.id = q.survey_version_id
   where v.survey_id = v_survey.id and v.version = v_survey.current_version
     and q.question_type = 'single_choice_with_optional_text'
   order by q.sort_order
   limit 1;
  if not found then
    raise exception 'survey_has_no_choice_question' using errcode = 'P0001';
  end if;
  v_min_days := coalesce((v_survey.prompt_rules ->> 'min_active_days_14d')::integer, 2);

  return (
    with answered as (
      -- The first answer day stays when a member later changes their choice.
      select a.user_id, a.choice_key, (a.created_at at time zone 'Asia/Jerusalem')::date as answered_on
        from public.survey_answers a
       where a.question_id = v_question.id
    ), scored as (
      select an.choice_key,
             (select count(*) from kc_private.user_active_days d
               where d.user_id = an.user_id and d.active_on > an.answered_on - 14
                 and d.active_on <= an.answered_on) >= v_min_days as qualified,
             an.answered_on <= v_today - 7 as measurable,
             exists (select 1 from kc_private.user_active_days d
                      where d.user_id = an.user_id and d.active_on >= an.answered_on + 7) as retained
        from answered an
    )
    select jsonb_build_object(
             'slug', v_survey.slug, 'title_he', v_survey.title_he, 'version', v_survey.current_version,
             'prompt_he', v_question.prompt_he, 'min_active_days_14d', v_min_days,
             'respondents_total', (select count(*) from scored),
             'respondents_qualified', (select count(*) from scored sc where sc.qualified),
             'options', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'key', o.opt ->> 'key', 'label_he', o.opt ->> 'label_he',
                        'count', (select count(*) from scored sc
                                   where sc.qualified and sc.choice_key = o.opt ->> 'key'),
                        'retention_base', (select count(*) from scored sc
                                            where sc.qualified and sc.measurable and sc.choice_key = o.opt ->> 'key'),
                        'retained', (select count(*) from scored sc
                                      where sc.qualified and sc.measurable and sc.retained
                                        and sc.choice_key = o.opt ->> 'key'))
                      order by o.ord)
                 from jsonb_array_elements(v_question.choice_options) with ordinality as o (opt, ord)),
               '[]'::jsonb)));
end;
$$;
comment on function public.admin_pmf_survey_report(text) is
  'Staff: Sean Ellis PMF counts per option among qualified respondents, with a 7-day retention check.';
grant execute on function public.admin_pmf_survey_report(text) to authenticated;
