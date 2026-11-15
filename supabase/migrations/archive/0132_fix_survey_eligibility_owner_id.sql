-- 0132_fix_survey_eligibility_owner_id.sql
-- Fixes a column-name bug in 0130_surveys_and_feedback.sql:
-- check_survey_prompt_eligibility referenced public.posts.user_id, but the
-- posts table's owner column is `owner_id`. When prompt_rules included
-- require_closure or require_profile_complete (as ux-experience does), the
-- function threw `column "user_id" does not exist`, surfacing to the client
-- as a 400 on /rpc/check_survey_prompt_eligibility and breaking the banner
-- + the runner side-effects that depend on it.
--
-- Mapped to spec: FR-SETTINGS-016 AC6.

begin;

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

  -- min_sessions gate (V1: client-passed, spoofable — see migration 0130 note)
  v_min_sessions := (v_prompt_rules->>'min_sessions')::int;
  if v_min_sessions is not null and p_session_count < v_min_sessions then
    v_show := false;
    v_reasons := array_append(v_reasons, 'session_count_below_threshold');
  end if;

  -- require_closure: user must own at least one closed_delivered post.
  -- BUG FIX: posts.owner_id is the column, not posts.user_id. The original
  -- 0130 migration shipped the wrong column name.
  v_require_closure := (v_prompt_rules->>'require_closure')::boolean;
  if v_require_closure = true then
    if not exists (
      select 1 from public.posts
       where owner_id = v_uid
         and status   = 'closed_delivered'
    ) then
      v_show := false;
      v_reasons := array_append(v_reasons, 'no_closed_delivered_post');
    end if;
  end if;

  -- require_profile_complete: display_name set + at least one non-removed post.
  -- Same posts.owner_id bug fix here.
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
       where owner_id = v_uid
         and status   <> 'removed_admin'
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

-- Grants are preserved from 0130 — `create or replace function` does not
-- reset them — but re-asserting keeps this migration self-contained.
revoke all on function public.check_survey_prompt_eligibility(text, int) from public, anon;
grant execute on function public.check_survey_prompt_eligibility(text, int) to authenticated;

commit;
