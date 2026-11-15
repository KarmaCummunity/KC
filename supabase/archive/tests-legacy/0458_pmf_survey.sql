-- supabase/tests/0458_pmf_survey.sql | 0455–0458: Sean Ellis PMF survey (KC#1058):
-- active-day recording, single-choice validation, the min_active_days_14d prompt gate,
-- and the admin PMF report (qualified respondents + 7-day retention per option).
-- Uses its own survey slug, so seeded surveys cannot skew the counts.

begin;

create or replace function pg_temp.mk_user(p_id uuid, p_handle text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (p_id, p_handle || '@test.local', now(),
          jsonb_build_object('full_name', 'Display ' || p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, display_name = 'Display ' || p_handle,
         account_status = 'active', onboarding_state = 'completed'
   where user_id = p_id;
end $$;

create or replace function pg_temp.as_user(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
end $$;

create or replace function pg_temp.as_system()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- Israel "today", the day boundary every 0455–0458 function uses.
create or replace function pg_temp.today_il()
returns date language sql as $$ select (now() at time zone 'Asia/Jerusalem')::date $$;

create or replace function pg_temp.mark_active(p_user uuid, p_day date)
returns void language sql as $$
  insert into public.user_active_days (user_id, active_on) values (p_user, p_day) on conflict do nothing
$$;

-- ── access control ──────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.rpc_record_active_day()', 'execute') then
    raise exception 'ASSERT FAILED: anon must not execute rpc_record_active_day';
  end if;
  if has_function_privilege('anon', 'public.admin_pmf_survey_report(text)', 'execute') then
    raise exception 'ASSERT FAILED: anon must not execute admin_pmf_survey_report';
  end if;
  if has_table_privilege('authenticated', 'public.user_active_days', 'select') then
    raise exception 'ASSERT FAILED: clients must not read user_active_days';
  end if;
end $$;

-- ── fixtures: 4 respondents, 1 moderator, 1 super admin to publish as ───────
do $$
begin
  perform pg_temp.mk_user('00000000-0000-0000-0000-0000045800a1', 'pmf_retained');
  perform pg_temp.mk_user('00000000-0000-0000-0000-0000045800b2', 'pmf_churned');
  perform pg_temp.mk_user('00000000-0000-0000-0000-0000045800c3', 'pmf_one_day');
  perform pg_temp.mk_user('00000000-0000-0000-0000-0000045800d4', 'pmf_today');
  perform pg_temp.mk_user('00000000-0000-0000-0000-0000045800e5', 'pmf_moderator');
  perform pg_temp.mk_user('00000000-0000-0000-0000-0000045800f6', 'pmf_publisher');
  insert into public.admin_role_grants (user_id, role) values ('00000000-0000-0000-0000-0000045800e5', 'moderator');
  update public.users set is_super_admin = true where user_id = '00000000-0000-0000-0000-0000045800f6';
end $$;

-- ── publish: options are validated by the table constraint ──────────────────
do $$
begin
  begin
    perform public.publish_survey_version('pmf-test-bad', 'x', null, true, '{}'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'question_type', 'single_choice_with_optional_text', 'short_label_he', 'q', 'prompt_he', 'q',
        'choice_options', jsonb_build_array(jsonb_build_object('key', 'only', 'label_he', 'only')))));
    raise exception 'ASSERT FAILED: a single-choice question with one option must be refused';
  exception when check_violation then
    null; -- expected
  end;

  -- Q1 single choice (the PMF question), Q2 a plain rating question.
  perform public.publish_survey_version('pmf-test-1058', 'PMF test', null, true,
    '{"min_active_days_14d": 2}'::jsonb,
    jsonb_build_array(
      jsonb_build_object(
        'question_type', 'single_choice_with_optional_text', 'short_label_he', 'pmf', 'prompt_he', 'pmf?',
        'choice_options', jsonb_build_array(
          jsonb_build_object('key', 'very_disappointed', 'label_he', 'very'),
          jsonb_build_object('key', 'somewhat_disappointed', 'label_he', 'somewhat'),
          jsonb_build_object('key', 'not_disappointed', 'label_he', 'not'))),
      jsonb_build_object('short_label_he', 'ease', 'prompt_he', 'ease?')));
end $$;

create temp table q on commit drop as
select qq.id, qq.question_type::text as question_type
  from public.survey_questions qq
  join public.survey_versions sv on sv.id = qq.survey_version_id
  join public.surveys s on s.id = sv.survey_id and sv.version = s.current_version
 where s.slug = 'pmf-test-1058';
grant select on q to authenticated;

-- ── active days + prompt gate ───────────────────────────────────────────────
do $$
declare
  v_u uuid := '00000000-0000-0000-0000-0000045800d4';
  v_elig json;
begin
  perform pg_temp.as_user(v_u);
  perform public.rpc_record_active_day();
  perform public.rpc_record_active_day(); -- same day again: still one row
  perform pg_temp.as_system();
  if (select count(*) from public.user_active_days where user_id = v_u) <> 1 then
    raise exception 'ASSERT FAILED: rpc_record_active_day must store one row per day';
  end if;

  perform pg_temp.as_user(v_u);
  v_elig := public.check_survey_prompt_eligibility('pmf-test-1058', 0);
  if (v_elig->>'show')::boolean or not (v_elig->'reasons')::jsonb ? 'active_days_below_threshold' then
    raise exception 'ASSERT FAILED: 1 active day must not qualify, got %', v_elig;
  end if;

  perform pg_temp.as_system();
  perform pg_temp.mark_active(v_u, pg_temp.today_il() - 1);
  perform pg_temp.as_user(v_u);
  v_elig := public.check_survey_prompt_eligibility('pmf-test-1058', 0);
  if not (v_elig->>'show')::boolean then
    raise exception 'ASSERT FAILED: 2 active days in 14 must qualify, got %', v_elig;
  end if;
  perform pg_temp.as_system();
end $$;

-- ── upsert validation + bundle ──────────────────────────────────────────────
do $$
declare
  v_u      uuid := '00000000-0000-0000-0000-0000045800d4';
  v_choice uuid := (select id from q where question_type = 'single_choice_with_optional_text');
  v_rating uuid := (select id from q where question_type = 'rating_1_7_with_optional_text');
  v_bundle json;
begin
  perform pg_temp.as_user(v_u);

  begin
    perform public.upsert_survey_answers('pmf-test-1058',
      jsonb_build_array(jsonb_build_object('question_id', v_choice, 'choice_key', 'delighted')));
    raise exception 'ASSERT FAILED: an unknown option key must be refused';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.upsert_survey_answers('pmf-test-1058',
      jsonb_build_array(jsonb_build_object('question_id', v_choice, 'rating', 5)));
    raise exception 'ASSERT FAILED: a rating on a single-choice question must be refused';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.upsert_survey_answers('pmf-test-1058',
      jsonb_build_array(jsonb_build_object('question_id', v_rating, 'choice_key', 'very_disappointed')));
    raise exception 'ASSERT FAILED: a choice on a rating question must be refused';
  exception when invalid_parameter_value then null;
  end;

  perform public.upsert_survey_answers('pmf-test-1058', jsonb_build_array(
    jsonb_build_object('question_id', v_choice, 'choice_key', 'not_disappointed', 'answer_text', 'meh'),
    jsonb_build_object('question_id', v_rating, 'rating', 4)));

  v_bundle := public.get_survey_bundle('pmf-test-1058');
  if json_array_length(v_bundle->'questions'->0->'choice_options') <> 3 then
    raise exception 'ASSERT FAILED: the bundle must carry the choice options, got %', v_bundle;
  end if;
  if not exists (
    select 1 from json_array_elements(v_bundle->'answers') a
     where a->>'choice_key' = 'not_disappointed' and a->>'rating' is null
  ) then
    raise exception 'ASSERT FAILED: the bundle must return the stored choice, got %', v_bundle->'answers';
  end if;
  perform pg_temp.as_system();
end $$;

-- ── report fixtures: answers 10 days ago, activity around them ──────────────
do $$
declare
  v_choice uuid := (select id from q where question_type = 'single_choice_with_optional_text');
  v_day    date := pg_temp.today_il() - 10;
  r record;
begin
  for r in select * from (values
    ('00000000-0000-0000-0000-0000045800a1'::uuid, 'very_disappointed'),
    ('00000000-0000-0000-0000-0000045800b2'::uuid, 'somewhat_disappointed'),
    ('00000000-0000-0000-0000-0000045800c3'::uuid, 'very_disappointed')) v(uid, choice_key)
  loop
    perform pg_temp.as_user(r.uid);
    perform public.upsert_survey_answers('pmf-test-1058',
      jsonb_build_array(jsonb_build_object('question_id', v_choice, 'choice_key', r.choice_key)));
  end loop;
  perform pg_temp.as_system();

  update public.survey_answers
     set created_at = now() - interval '10 days'
   where question_id = v_choice
     and user_id in ('00000000-0000-0000-0000-0000045800a1', '00000000-0000-0000-0000-0000045800b2',
                     '00000000-0000-0000-0000-0000045800c3');

  -- a1: qualified (2 days), back 8 days after answering. b2: qualified, never back.
  -- c3: one active day only, so not qualified.
  perform pg_temp.mark_active('00000000-0000-0000-0000-0000045800a1', v_day - 1);
  perform pg_temp.mark_active('00000000-0000-0000-0000-0000045800a1', v_day);
  perform pg_temp.mark_active('00000000-0000-0000-0000-0000045800a1', v_day + 8);
  perform pg_temp.mark_active('00000000-0000-0000-0000-0000045800b2', v_day - 3);
  perform pg_temp.mark_active('00000000-0000-0000-0000-0000045800b2', v_day);
  perform pg_temp.mark_active('00000000-0000-0000-0000-0000045800c3', v_day);
end $$;

-- ── report ──────────────────────────────────────────────────────────────────
do $$
declare
  v_report json;
  v_opt    json;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000045800b2');
  begin
    perform public.admin_pmf_survey_report('pmf-test-1058');
    raise exception 'ASSERT FAILED: a non-admin must be refused';
  exception when insufficient_privilege then null;
  end;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000045800e5');
  v_report := public.admin_pmf_survey_report('pmf-test-1058');

  if (v_report->>'respondents_total')::int <> 4 or (v_report->>'respondents_qualified')::int <> 3 then
    raise exception 'ASSERT FAILED: expected 4 respondents, 3 qualified, got %', v_report;
  end if;

  -- {key: [count, retention_base, retained]} among qualified respondents.
  for v_opt in select * from json_array_elements(v_report->'options')
  loop
    if (v_opt->>'key', (v_opt->>'count')::int, (v_opt->>'retention_base')::int, (v_opt->>'retained')::int)
       not in (('very_disappointed', 1, 1, 1), ('somewhat_disappointed', 1, 1, 0), ('not_disappointed', 1, 0, 0)) then
      raise exception 'ASSERT FAILED: unexpected option row %', v_opt;
    end if;
  end loop;
  if json_array_length(v_report->'options') <> 3 then
    raise exception 'ASSERT FAILED: the report must list all 3 options in order, got %', v_report->'options';
  end if;

  -- The generic results view counts every answer (qualified or not) per option.
  if (select (c->>'count')::int
        from json_array_elements(public.admin_survey_results('pmf-test-1058')->'questions'->0->'choice_counts') c
       where c->>'key' = 'very_disappointed') <> 2 then
    raise exception 'ASSERT FAILED: admin_survey_results must count choice answers';
  end if;
  perform pg_temp.as_system();
end $$;

rollback;

\echo '✓ 0458_pmf_survey.sql passed'
