-- Research: surveys are published by the super admin, answered through one RPC and private;
-- the prompt rule is decided on the server; the public form is stored only through the
-- service-role function, with rate limits and a rotating salt.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- `@x` is a member, `#NN` a post of the fixture.
create function pg_temp.sql(p_sql text)
returns text
language sql
as $$
  select regexp_replace(regexp_replace(p_sql, '@([a-e])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g'),
                        '#(\d\d)', '''10000000-0000-4000-8000-0000000000\1''::uuid', 'g');
$$;
-- Runs a statement as a member (anon when null, the service role for `s`): 'ok', a P0001
-- message, or the SQLSTATE.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_role constant text := case when p_who is null then 'anon' when p_who = 's' then 'service_role'
                               else 'authenticated' end;
  v_sql constant text := pg_temp.sql(p_sql);
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', v_role)::text, true);
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

select plan(32);

insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd']) x;
insert into public.admin_role_grants (user_id, role) values ('00000000-0000-4000-8000-00000000000d', 'super_admin');

-- The question at a position of the current version.
create function pg_temp.q(p_order integer)
returns uuid
language sql
as $$
  select q.id from public.survey_questions q
    join public.survey_versions v on v.id = q.survey_version_id
    join public.surveys s on s.id = v.survey_id and s.current_version = v.version
   where q.sort_order = p_order;
$$;
-- Publishes a version with a rating question and a choice question.
create function pg_temp.publish(p_who text)
returns text
language sql
as $$
  select pg_temp.act(p_who, $q$select public.publish_survey_version('pmf', 'PMF', null, true,
    '{"min_sessions": 2, "min_active_days_14d": 1}',
    '[{"short_label_he": "use", "prompt_he": "how useful?"},
      {"question_type": "single_choice_with_optional_text", "short_label_he": "miss", "prompt_he": "would you miss it?",
       "choice_options": [{"key": "very", "label_he": "very"}, {"key": "not", "label_he": "not"}]}]')$q$);
$$;
-- Saves answers; `q1` / `q2` stand for the two questions.
create function pg_temp.answer(p_who text, p_answers text)
returns text
language sql
as $$
  select pg_temp.act(p_who, format('select public.upsert_survey_answers(%L, %L)', 'pmf',
    replace(replace(p_answers, 'q1', pg_temp.q(1)::text), 'q2', pg_temp.q(2)::text)));
$$;
-- Submits a public response as the Edge Function does, from an address hash of one repeated digit.
create function pg_temp.submit(p_ip text, p_honeypot text default null, p_version integer default 1, p_email text default null)
returns text
language sql
as $$
  select pg_temp.act('s', format(
    'select public.submit_public_research_response(%L, %s, %L, %L, null, %L, %L, %L, %L)',
    'pmf', p_version, 'share-thanks', repeat(p_ip, 64), '{"q": {"rating": 5}}', p_honeypot, p_email, 'evenings'));
$$;

-- ── Publishing and reading ───────────────────────────────────────────────────
select is(pg_temp.publish('a'), '42501', 'only the super admin publishes a survey');
select is(pg_temp.publish('d'), 'ok', 'the super admin publishes the first version');
select is(pg_temp.get('a', $$select count(*) from public.survey_questions q join public.survey_versions v on v.id = q.survey_version_id
    join public.surveys s on s.id = v.survey_id$$), '2', 'members read a published survey with its questions');
select is(pg_temp.act(null, 'select 1 from public.surveys'), '42501', 'a signed-out caller reads no survey');
update public.surveys set is_active = false;
select is(pg_temp.get('a', 'select count(*) from public.surveys') || '/' || pg_temp.get('a', 'select count(*) from public.survey_questions')
       || '/' || pg_temp.get('d', 'select count(*) from public.surveys'), '0/0/1',
  'a retired survey and its questions are hidden from members, not from the super admin');
update public.surveys set is_active = true;

-- ── Answers ──────────────────────────────────────────────────────────────────
select is(pg_temp.answer('b', '[{"question_id": "q1", "rating": 5, "answer_text": " good "}]'), 'ok', 'a member answers a rating question');
select is(pg_temp.answer('b', '[{"question_id": "q1", "rating": 6}, {"question_id": "q2", "choice_key": "very"}]'), 'ok',
  'answers may be changed, and a choice question takes one of its options');
select is((select string_agg(coalesce(rating::text, choice_key), ',' order by rating) from public.survey_answers), '6,very',
  'one answer per question is kept');
select is(pg_temp.answer('b', '[{"question_id": "q2", "choice_key": "maybe"}]'), 'invalid_input', 'a key that is not an option is refused');
select is(pg_temp.answer('b', '[{"question_id": "q2", "rating": 3}]'), 'invalid_input', 'a choice question takes no rating');
select is(pg_temp.answer('b', '[{"question_id": "q1", "rating": 9}]'), '23514', 'a rating is 1 to 7');
select is(pg_temp.act('b', $$select public.upsert_survey_answers('nope', '[]')$$), 'survey_not_found', 'an unknown survey is refused');
select is(pg_temp.act('b', $$insert into public.survey_answers (user_id, question_id, rating)
    select @b, id, 1 from public.survey_questions$$), '42501', 'answers are not written directly');
select is(pg_temp.get('b', 'select count(*) from public.survey_answers') || '/' || pg_temp.get('a', 'select count(*) from public.survey_answers')
       || '/' || pg_temp.get('d', 'select count(*) from public.survey_answers'), '2/0/2',
  'answers are read by their author and the super admin only');

-- ── Prompt rule ──────────────────────────────────────────────────────────────
select is(pg_temp.get('b', $$select public.check_survey_prompt_eligibility('pmf', 5) ->> 'reasons'$$),
  '["already_completed", "active_days_below_threshold"]', 'a member who answered everything is not prompted');
select is(pg_temp.get('a', $$select public.check_survey_prompt_eligibility('pmf', 1) ->> 'reasons'$$),
  '["session_count_below_threshold", "active_days_below_threshold"]', 'every unmet rule is named');
select is(pg_temp.act('a', 'select public.record_active_day()'), 'ok', 'Alice opens the app');
select is(pg_temp.get('a', $$select public.check_survey_prompt_eligibility('pmf', 2)::text$$),
  '{"show": true, "reasons": ["eligible"]}', 'with the rules met the prompt is offered');
select is(pg_temp.publish('d'), 'ok', 'the super admin publishes again');
select is((select current_version from public.surveys), 2, 'which is version 2');
select is(pg_temp.get('b', $$select (public.check_survey_prompt_eligibility('pmf', 5) -> 'reasons') ? 'already_completed'$$), 'false',
  'a new version starts every member over');

-- ── Public research form ─────────────────────────────────────────────────────
select is(pg_temp.submit('a', null, 2, 'x@mail.test'), 'ok', 'the service role stores an anonymous response');
select is((select count(*) || '/' || min(r.source) || '/' || min(c.contact_window) from kc_private.research_responses r
            join kc_private.research_contact_requests c on c.response_id = r.id), '1/share-thanks/evenings',
  'with its source and, apart, the contact request');
select is(pg_temp.submit('b', 'i am a bot', 2) || '/' || (select count(*) from kc_private.research_responses), 'ok/1',
  'a filled honeypot is answered politely and stores nothing');
select is(pg_temp.submit('b', null, 1), 'survey_not_found_or_version_mismatch', 'a response to an old version is refused');
select is((select string_agg(pg_temp.submit('c', null, 2), ',') from generate_series(1, 6)), 'ok,ok,ok,ok,ok,rate_limited_minute',
  'the sixth response of one address in a minute is refused');
select is(pg_temp.act('a', $$select public.submit_public_research_response('pmf', 2, 'x', repeat('a', 64), null, '{}', null)$$) || '/'
       || pg_temp.act('a', 'select public.get_research_salt()') || '/' || pg_temp.act('a', 'select 1 from kc_private.research_responses')
       , '42501/42501/42501',
  'the submit and salt functions and the response tables are closed to members and signed-out callers');
select is(pg_temp.act(null, $$select public.get_public_research_questions('pmf') ->> 'version'$$) || '/'
       || pg_temp.act('a', $$select public.get_public_research_questions('pmf') ->> 'version'$$), 'ok/ok',
  'the questions are readable by signed-out and signed-in callers (the page uses the anonymous key)');
select is(char_length(public.get_research_salt()) || '/' || (public.get_research_salt() = public.get_research_salt()), '64/true',
  'the salt is created on first use and stays until rotated');
create temporary table salt_before as select public.get_research_salt() as value;
select lives_ok('select public.rotate_research_salt()', 'the salt is rotated');
select is((select public.get_research_salt() <> value from salt_before), true, 'rotation replaces it');
select is(public.get_public_research_questions('pmf') ->> 'version' || '/'
          || jsonb_array_length(public.get_public_research_questions('pmf') -> 'questions'), '2/2',
  'the form reads the current questions');

select * from finish();
rollback;
