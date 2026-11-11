-- 0457_pmf_survey_eligibility_and_seed | KC#1058 — Sean Ellis PMF survey, part 2.
--
-- 1. `check_survey_prompt_eligibility`: new prompt rule `min_active_days_14d`
--    (distinct active days in the last 14 Israel days, from `user_active_days`).
-- 2. `publish_survey_version`: questions may set `question_type` + `choice_options`.
-- 3. Seeds survey `pmf-sean-ellis`: the standard question, its 3 options and an
--    optional "main benefit" text. Shown to users active on ≥ 2 days in 2 weeks.
--
-- Mapped to spec: FR-SETTINGS-016 AC6 / AC8. Idempotent.

-- ---------------------------------------------------------------------------
-- 1. Eligibility — body of 0132 plus the active-days gate
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
  v_uid               uuid := auth.uid();
  v_survey_id         uuid;
  v_version           int;
  v_prompt_rules      jsonb;
  v_sv_id             uuid;
  v_q_total           int;
  v_ans_count         int;
  v_min_sessions      int;
  v_min_active_days   int;
  v_require_closure   boolean;
  v_require_profile   boolean;
  v_reasons           text[] := '{}';
  v_show              boolean := true;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select id, current_version, prompt_rules
    into v_survey_id, v_version, v_prompt_rules
    from public.surveys
   where slug = p_slug
     and is_active = true
     and current_version > 0;

  if v_survey_id is null then
    return json_build_object('show', false, 'reasons', array['survey_inactive_or_not_found']);
  end if;

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

  -- min_sessions gate (client-passed, see 0130).
  v_min_sessions := (v_prompt_rules->>'min_sessions')::int;
  if v_min_sessions is not null and p_session_count < v_min_sessions then
    v_show := false;
    v_reasons := array_append(v_reasons, 'session_count_below_threshold');
  end if;

  -- min_active_days_14d gate (server-side activity, KC#1058).
  v_min_active_days := (v_prompt_rules->>'min_active_days_14d')::int;
  if v_min_active_days is not null
     and public.user_active_days_14d(v_uid, (now() at time zone 'Asia/Jerusalem')::date) < v_min_active_days then
    v_show := false;
    v_reasons := array_append(v_reasons, 'active_days_below_threshold');
  end if;

  -- require_closure: the user owns at least one closed_delivered post.
  v_require_closure := (v_prompt_rules->>'require_closure')::boolean;
  if v_require_closure = true and not exists (
    select 1 from public.posts where owner_id = v_uid and status = 'closed_delivered'
  ) then
    v_show := false;
    v_reasons := array_append(v_reasons, 'no_closed_delivered_post');
  end if;

  -- require_profile_complete: display name set + at least one non-removed post.
  v_require_profile := (v_prompt_rules->>'require_profile_complete')::boolean;
  if v_require_profile = true then
    if not exists (
      select 1 from public.users
       where user_id = v_uid and display_name is not null and display_name <> ''
    ) then
      v_show := false;
      v_reasons := array_append(v_reasons, 'profile_incomplete_display_name');
    end if;

    if not exists (
      select 1 from public.posts where owner_id = v_uid and status <> 'removed_admin' limit 1
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

-- ---------------------------------------------------------------------------
-- 2. Publish — body of 0130 plus `question_type` / `choice_options` per question
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
  -- Super admin only; migration-time seeding runs without a JWT (auth.uid() is null).
  if v_uid is not null and not public.has_admin_role(v_uid, 'super_admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_questions is null or jsonb_array_length(p_questions) = 0 then
    raise exception 'questions_required' using errcode = '22023';
  end if;

  insert into public.surveys (slug, title_he, description_he, is_active, prompt_rules)
  values (p_slug, p_title_he, p_description_he, p_is_active, coalesce(p_prompt_rules, '{}'::jsonb))
  on conflict (slug) do update set
    title_he       = excluded.title_he,
    description_he = excluded.description_he,
    is_active      = excluded.is_active,
    prompt_rules   = excluded.prompt_rules,
    updated_at     = now()
  returning id into v_survey_id;

  update public.surveys
     set current_version = current_version + 1,
         updated_at      = now()
   where id = v_survey_id
  returning current_version into v_version;

  -- Publisher: the caller, else the first super admin (migration-time seeding).
  if v_uid is not null then
    v_publisher := v_uid;
  else
    select user_id into v_publisher
      from public.users
     where is_super_admin = true
     order by created_at asc
     limit 1;
  end if;

  insert into public.survey_versions (survey_id, version, published_by)
  values (v_survey_id, v_version, v_publisher)
  returning id into v_sv_id;

  -- Questions in array order; the table's check constraint validates choice_options.
  for v_q in select * from jsonb_array_elements(p_questions)
  loop
    v_i := v_i + 1;
    insert into public.survey_questions (
      survey_version_id, sort_order, question_type, short_label_he, prompt_he, context_he,
      text_placeholder_he, rating_anchor_low_he, rating_anchor_high_he, choice_options
    ) values (
      v_sv_id,
      v_i,
      coalesce(v_q->>'question_type', 'rating_1_7_with_optional_text')::public.survey_question_type,
      v_q->>'short_label_he',
      v_q->>'prompt_he',
      coalesce(v_q->>'context_he', ''),
      coalesce(v_q->>'text_placeholder_he', ''),
      coalesce(v_q->>'rating_anchor_low_he',  'לא מספיק'),
      coalesce(v_q->>'rating_anchor_high_he', 'מצוין'),
      v_q->'choice_options'
    );
  end loop;

  return json_build_object('slug', p_slug, 'version', v_version, 'questions_count', v_i);
end;
$$;

revoke all on function public.publish_survey_version(text, text, text, boolean, jsonb, jsonb) from public, anon;
grant execute on function public.publish_survey_version(text, text, text, boolean, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Seed the Sean Ellis survey (same guard as 0437: needs a super admin to publish as)
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from public.users where is_super_admin = true) then
    return;
  end if;

  if not exists (select 1 from public.surveys where slug = 'pmf-sean-ellis') then
    perform public.publish_survey_version(
      'pmf-sean-ellis',
      'שאלה אחת קצרה',
      'תשובה אחת שעוזרת לנו להבין כמה קהילת קארמה חשובה לך.',
      true,
      '{"min_active_days_14d": 2}'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'question_type',       'single_choice_with_optional_text',
        'short_label_he',      'בלי קהילת קארמה',
        'prompt_he',           'איך היית מרגיש/ה אם לא היית יכול/ה להשתמש יותר בקהילת קארמה?',
        'text_placeholder_he', 'מה הדבר העיקרי שקהילת קארמה נותנת לך?',
        'choice_options', jsonb_build_array(
          jsonb_build_object('key', 'very_disappointed',     'label_he', 'מאוד מאוכזב/ת'),
          jsonb_build_object('key', 'somewhat_disappointed', 'label_he', 'קצת מאוכזב/ת'),
          jsonb_build_object('key', 'not_disappointed',      'label_he', 'לא מאוכזב/ת (זה לא באמת שימושי לי)')
        )
      ))
    );
  end if;
end $$;
