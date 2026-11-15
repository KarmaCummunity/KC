-- Research reports: free feedback is written by its author and read by staff only; the admin
-- survey dashboard (overview, results, PMF card) admits moderators and more senior staff and
-- counts the current version only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- `@x` is a member of the fixture.
create function pg_temp.sql(p_sql text)
returns text
language sql
as $$
  select regexp_replace(p_sql, '@([a-e])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
$$;
-- Runs a statement as a member (anon when null): 'ok', a P0001 message, or the SQLSTATE.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_role constant text := case when p_who is null then 'anon' else 'authenticated' end;
  v_sql constant text := pg_temp.sql(p_sql);
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000' || coalesce(p_who, 'z'), 'role', v_role)::text, true);
  perform set_config('role', v_role, true);
  execute v_sql;
  perform set_config('role', 'none', true);
  return 'ok';
exception when others then
  perform set_config('role', 'none', true);
  return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
end;
$$;
-- One value a member reads with a query.
create function pg_temp.get(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.sql(p_sql);
  v_value text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute v_sql into v_value;
  perform set_config('role', 'none', true);
  return v_value;
end;
$$;

select plan(22);

-- a, b members · c moderator · d super admin · e support
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd', 'e']) x;
update public.users set display_name = 'Member ' || right(id::text, 1);
insert into public.admin_role_grants (user_id, role) values
  ('00000000-0000-4000-8000-00000000000c', 'moderator'),
  ('00000000-0000-4000-8000-00000000000d', 'super_admin'),
  ('00000000-0000-4000-8000-00000000000e', 'support');

-- The question at a position of the current version of the PMF survey.
create function pg_temp.q(p_order integer)
returns uuid
language sql
as $$
  select q.id from public.survey_questions q
    join public.survey_versions v on v.id = q.survey_version_id
    join public.surveys s on s.id = v.survey_id and s.current_version = v.version
   where s.slug = 'pmf-sean-ellis' and q.sort_order = p_order;
$$;
create function pg_temp.publish(p_slug text, p_questions text)
returns text
language sql
as $$
  select pg_temp.act('d', format($q$select public.publish_survey_version(%L, 'PMF', null, true,
    '{"min_active_days_14d": 2}', %L)$q$, p_slug, p_questions));
$$;
create function pg_temp.answer(p_who text, p_answers text)
returns text
language sql
as $$
  select pg_temp.act(p_who, format('select public.upsert_survey_answers(%L, %L)', 'pmf-sean-ellis',
    replace(replace(p_answers, 'q1', pg_temp.q(1)::text), 'q2', pg_temp.q(2)::text)));
$$;

-- ── Free feedback ────────────────────────────────────────────────────────────
select is(pg_temp.act('a', $$insert into public.user_feedback (user_id, rating, body) values (@a, 6, 'Useful app, thanks')$$),
  'ok', 'a member files feedback');
select is(pg_temp.act('a', $$insert into public.user_feedback (user_id, body) values (@b, 'Written for someone else')$$),
  '42501', 'feedback is filed only as oneself');
select is(pg_temp.act('b', $$insert into public.user_feedback (user_id, body) values (@b, 'short')$$),
  '23514', 'the text is at least 10 characters');
select is(pg_temp.act('b', $$insert into public.user_feedback (user_id, body) values (@b, 'Second piece of feedback')$$),
  'ok', 'feedback without a rating is accepted');
select is(pg_temp.act('a', 'select 1 from public.user_feedback') || '/' || pg_temp.act('d', 'select 1 from public.user_feedback'),
  '42501/42501', 'nobody reads the table directly');
select is(pg_temp.act('a', 'select public.admin_user_feedback_list()') || '/' || pg_temp.act('e', 'select public.admin_user_feedback_list()')
       || '/' || pg_temp.act(null, 'select public.admin_user_feedback_list()'), '42501/42501/42501',
  'members, support staff and signed-out callers do not read the feedback list');
update public.user_feedback set created_at = now() - interval '1 hour' where user_id = '00000000-0000-4000-8000-00000000000a';
select is(pg_temp.get('c', $$select string_agg(display_name || ':' || coalesce(rating::text, '-'), ',') from public.admin_user_feedback_list()$$),
  'Member b:-,Member a:6', 'a moderator reads the list newest first, with names');
select is(pg_temp.get('c', $$select display_name from public.admin_user_feedback_list(1,
    (select next_cursor from public.admin_user_feedback_list(1)))$$), 'Member a', 'the cursor continues after the last row');

-- ── Survey reports ───────────────────────────────────────────────────────────
select is(pg_temp.publish('pmf-sean-ellis', '[{"short_label_he": "use", "prompt_he": "how useful?"},
    {"question_type": "single_choice_with_optional_text", "short_label_he": "miss", "prompt_he": "would you miss it?",
     "choice_options": [{"key": "very", "label_he": "very"}, {"key": "somewhat", "label_he": "somewhat"}]}]'),
  'ok', 'the super admin publishes the PMF survey');
select is(pg_temp.answer('a', '[{"question_id": "q1", "rating": 6, "answer_text": "great"}, {"question_id": "q2", "choice_key": "very"}]')
       || '/' || pg_temp.answer('b', '[{"question_id": "q2", "choice_key": "somewhat"}]'), 'ok/ok', 'two members answer');
select is(pg_temp.act('a', 'select public.admin_survey_overview()') || '/' || pg_temp.act('e', $$select public.admin_survey_results('pmf-sean-ellis')$$)
       || '/' || pg_temp.act('b', $$select public.admin_pmf_survey_report()$$), '42501/42501/42501',
  'members and support staff read no survey report');
select is(pg_temp.get('c', $$select (r ->> 'question_count') || '/' || (r ->> 'respondent_count') || '/' || (r ->> 'response_total')
    from jsonb_array_elements(public.admin_survey_overview()) r$$), '2/2/3', 'the overview counts questions, respondents and answers');
select is(pg_temp.get('c', $$select public.admin_survey_results('pmf-sean-ellis') -> 'questions' -> 0 ->> 'avg_rating'
    || '/' || (public.admin_survey_results('pmf-sean-ellis') -> 'questions' -> 0 ->> 'distribution')$$),
  '6.00/[0, 0, 0, 0, 0, 1, 0]', 'a rating question has its average and distribution');
select is(pg_temp.get('d', $$select public.admin_survey_results('pmf-sean-ellis') -> 'questions' -> 1 ->> 'choice_counts'$$),
  '[{"key": "very", "count": 1, "label_he": "very"}, {"key": "somewhat", "count": 1, "label_he": "somewhat"}]',
  'a choice question counts each option');
-- Alice answered a day earlier (the updated_at trigger is paused so the past time sticks).
alter table public.survey_answers disable trigger survey_answers_set_updated_at;
update public.survey_answers set updated_at = now() - interval '1 day' where user_id = '00000000-0000-4000-8000-00000000000a';
alter table public.survey_answers enable trigger survey_answers_set_updated_at;
select is(pg_temp.get('c', $$select string_agg((r ->> 'display_name') || ':' || jsonb_array_length(r -> 'answers'), ',')
    from jsonb_array_elements(public.admin_survey_results('pmf-sean-ellis') -> 'respondents') r$$),
  'Member b:1,Member a:2', 'respondents are listed most recent first with their answers');
select is(pg_temp.act('c', $$select public.admin_survey_results('nope')$$), 'survey_not_found', 'an unknown survey is refused');

-- PMF: Alice answered ten days ago, active on two days before and once a week later; Bob
-- answered today with one active day.
update public.survey_answers set created_at = now() - interval '10 days' where user_id = '00000000-0000-4000-8000-00000000000a';
insert into kc_private.user_active_days (user_id, active_on)
select '00000000-0000-4000-8000-00000000000a'::uuid, (now() at time zone 'Asia/Jerusalem')::date - d
  from unnest(array[11, 10, 2]) d
union all
select '00000000-0000-4000-8000-00000000000b'::uuid, (now() at time zone 'Asia/Jerusalem')::date;
select is(pg_temp.get('c', $$select (r ->> 'respondents_total') || '/' || (r ->> 'respondents_qualified') || '/' || (r ->> 'min_active_days_14d')
    from public.admin_pmf_survey_report() r$$), '2/1/2', 'only respondents active on two days before answering qualify');
select is(pg_temp.get('c', $$select string_agg((o ->> 'key') || ':' || (o ->> 'count') || ':' || (o ->> 'retention_base') || ':' || (o ->> 'retained'), ',')
    from jsonb_array_elements(public.admin_pmf_survey_report() -> 'options') o$$), 'very:1:1:1,somewhat:0:0:0',
  'each option counts qualified answers and their 7-day retention');
select is(pg_temp.publish('ratings-only', '[{"short_label_he": "use", "prompt_he": "how useful?"}]') || '/'
       || pg_temp.act('c', $$select public.admin_pmf_survey_report('ratings-only')$$), 'ok/survey_has_no_choice_question',
  'the PMF card needs a single-choice question');
select is(pg_temp.publish('pmf-sean-ellis', '[{"short_label_he": "use", "prompt_he": "how useful?"}]') || '/'
       || pg_temp.get('c', $$select string_agg((r ->> 'respondent_count'), ',' order by r ->> 'slug')
            from jsonb_array_elements(public.admin_survey_overview()) r$$), 'ok/0,0',
  'a new version starts the counts over');

-- ── Account removal ──────────────────────────────────────────────────────────
delete from auth.users where id = '00000000-0000-4000-8000-00000000000a';
select is((select count(*) from public.user_feedback)::integer, 1, 'feedback goes with its author');
select is(pg_temp.get('c', 'select count(*) from public.admin_user_feedback_list()'), '1', 'and leaves the staff list');

select * from finish();
rollback;
