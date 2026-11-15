-- Research · survey RPCs (FR-SETTINGS-016)
--
-- Reading a survey needs no RPC: the app selects `surveys` with its current version, the
-- questions and the caller's own answers under RLS. These are the writes and the prompt rule.

-- Saves the caller's answers to questions of the survey's current version; an answer given
-- before is replaced (FR-SETTINGS-016 AC4).
--   p_answers   [{ "question_id", "rating" | "choice_key", "answer_text"? }], at most 50
--   survey_not_found   no active, published survey with this slug
--   invalid_input      not an array, a question of another version, a rating on a choice
--                      question (or the reverse), or a key that is not one of its options
create function public.upsert_survey_answers(p_slug text, p_answers jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_version_id uuid;
  v_written integer;
begin
  select v.id into v_version_id
    from public.surveys s
    join public.survey_versions v on v.survey_id = s.id and v.version = s.current_version
   where s.slug = p_slug and s.is_active;
  if not found then
    raise exception 'survey_not_found' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers) > 50 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  insert into public.survey_answers as sa (user_id, question_id, rating, choice_key, answer_text)
  select v_user_id, q.id, a.rating, a.choice_key, nullif(btrim(a.answer_text), '')
    from jsonb_to_recordset(p_answers)
           as a (question_id uuid, rating integer, choice_key text, answer_text text)
    join public.survey_questions q on q.id = a.question_id and q.survey_version_id = v_version_id
   where case q.question_type
           when 'single_choice_with_optional_text' then
             a.rating is null
             and q.choice_options @> jsonb_build_array(jsonb_build_object('key', a.choice_key))
           else a.choice_key is null and a.rating is not null end
  on conflict (user_id, question_id) do update
    set rating = excluded.rating, choice_key = excluded.choice_key, answer_text = excluded.answer_text;
  get diagnostics v_written = row_count;
  -- All or nothing: one answer that does not fit its question refuses the call.
  if v_written <> jsonb_array_length(p_answers) then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
end;
$$;
comment on function public.upsert_survey_answers(text, jsonb) is
  'Saves the caller''s answers to the current version of a survey.';
grant execute on function public.upsert_survey_answers(text, jsonb) to authenticated;

-- Whether the survey's prompt banner should be offered to the caller now
-- (FR-SETTINGS-016 AC6, AC10): { "show": bool, "reasons": [text] }. The session count is
-- the device's own number; active days are counted on the server.
create function public.check_survey_prompt_eligibility(p_slug text, p_session_count integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
  v_survey public.surveys;
  v_reasons text[] := '{}';
begin
  select s.* into v_survey from public.surveys s
   where s.slug = p_slug and s.is_active and s.current_version > 0;
  if not found then
    return jsonb_build_object('show', false, 'reasons', array['survey_inactive_or_not_found']);
  end if;

  -- Every question of the current version already has the caller's answer.
  if not exists (
       select 1
         from public.survey_versions v
         join public.survey_questions q on q.survey_version_id = v.id
        where v.survey_id = v_survey.id and v.version = v_survey.current_version
          and not exists (select 1 from public.survey_answers a
                           where a.user_id = v_user_id and a.question_id = q.id)) then
    v_reasons := array_append(v_reasons, 'already_completed');
  end if;
  if coalesce(p_session_count, 0) < (v_survey.prompt_rules ->> 'min_sessions')::integer then
    v_reasons := array_append(v_reasons, 'session_count_below_threshold');
  end if;
  if kc_private.user_active_days_14d(v_user_id) < (v_survey.prompt_rules ->> 'min_active_days_14d')::integer then
    v_reasons := array_append(v_reasons, 'active_days_below_threshold');
  end if;
  if (v_survey.prompt_rules ->> 'require_closure')::boolean and not exists (
       select 1 from public.posts p where p.owner_id = v_user_id and p.status = 'closed_delivered') then
    v_reasons := array_append(v_reasons, 'no_closed_delivered_post');
  end if;
  if (v_survey.prompt_rules ->> 'require_profile_complete')::boolean then
    if not exists (select 1 from public.users u where u.id = v_user_id and u.display_name is not null) then
      v_reasons := array_append(v_reasons, 'profile_incomplete_display_name');
    end if;
    if not exists (select 1 from public.user_stats s where s.user_id = v_user_id and s.posts_created_total > 0) then
      v_reasons := array_append(v_reasons, 'profile_incomplete_no_post');
    end if;
  end if;

  return jsonb_build_object(
    'show', cardinality(v_reasons) = 0,
    'reasons', case when cardinality(v_reasons) = 0 then array['eligible'] else v_reasons end);
end;
$$;
comment on function public.check_survey_prompt_eligibility(text, integer) is
  'Whether the caller should be offered a survey''s prompt banner, with the reasons.';
grant execute on function public.check_survey_prompt_eligibility(text, integer) to authenticated;

-- Publishes a new version of a survey, creating the survey on first use
-- (FR-SETTINGS-016 AC5, AC7). Super admin only. Returns the new version number.
--   p_questions   [{ "question_type"?, "short_label_he", "prompt_he", "context_he"?,
--                    "text_placeholder_he"?, "rating_anchor_low_he"?, "rating_anchor_high_he"?,
--                    "choice_options"? }] in display order, 1 to 50
--   forbidden (42501) · invalid_input
create function public.publish_survey_version(
  p_slug text, p_title_he text, p_description_he text, p_is_active boolean, p_prompt_rules jsonb,
  p_questions jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id constant uuid := kc_private.require_admin_role('super_admin');
  v_survey public.surveys;
  v_version_id uuid;
begin
  if jsonb_typeof(p_questions) is distinct from 'array'
     or jsonb_array_length(p_questions) not between 1 and 50 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  insert into public.surveys as s (slug, title_he, description_he, is_active, prompt_rules, current_version)
  values (p_slug, p_title_he, p_description_he, coalesce(p_is_active, true),
          coalesce(p_prompt_rules, '{}'::jsonb), 1)
  on conflict (slug) do update
    set title_he = excluded.title_he, description_he = excluded.description_he,
        is_active = excluded.is_active, prompt_rules = excluded.prompt_rules,
        current_version = s.current_version + 1
  returning s.* into v_survey;

  insert into public.survey_versions (survey_id, version, published_by)
  values (v_survey.id, v_survey.current_version, v_admin_id)
  returning id into v_version_id;

  insert into public.survey_questions (
    survey_version_id, sort_order, question_type, short_label_he, prompt_he, context_he,
    text_placeholder_he, rating_anchor_low_he, rating_anchor_high_he, choice_options)
  select v_version_id, q.ordinality::integer,
         coalesce(q.item ->> 'question_type', 'rating_1_7_with_optional_text'),
         q.item ->> 'short_label_he', q.item ->> 'prompt_he', coalesce(q.item ->> 'context_he', ''),
         coalesce(q.item ->> 'text_placeholder_he', ''), coalesce(q.item ->> 'rating_anchor_low_he', ''),
         coalesce(q.item ->> 'rating_anchor_high_he', ''), q.item -> 'choice_options'
    from jsonb_array_elements(p_questions) with ordinality as q (item, ordinality);

  perform kc_private.audit_record(
    'survey_version_published', 'survey', v_survey.id,
    jsonb_build_object('slug', p_slug, 'version', v_survey.current_version));
  return v_survey.current_version;
end;
$$;
comment on function public.publish_survey_version(text, text, text, boolean, jsonb, jsonb) is
  'Super admin: publishes a new version of a survey with its questions.';
grant execute on function public.publish_survey_version(text, text, text, boolean, jsonb, jsonb) to authenticated;
