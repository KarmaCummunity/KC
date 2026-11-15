-- FR-MOD-002 / FR-CHAT-007 AC3 — submit a support issue and inject a system
-- message into the caller's support thread in one atomic call.
--
-- Motivation: inject_system_message lost its `authenticated` EXECUTE grant in
-- migration 0070 (security hardening §15.11). A SECURITY DEFINER wrapper here
-- lets the app layer submit an issue without regaining the raw injection grant.
--
-- Returns the chats row so the caller can navigate directly to the thread.

create or replace function public.rpc_submit_support_issue(
  p_category    text,
  p_description text
)
returns public.chats
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_chat_id  uuid;
  v_issue_id uuid := gen_random_uuid();
  v_payload  jsonb;
  v_body     text;
  v_chat     public.chats;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = 'check_violation';
  end if;

  if length(trim(coalesce(p_description, ''))) < 10 then
    raise exception 'description_too_short' using errcode = 'check_violation';
  end if;

  -- Get or create the support thread (reuses the internal helper from 0005).
  v_chat_id := public.find_or_create_support_chat(v_uid);

  -- Build a structured payload so SupportIssueBubble can render it richly.
  v_payload := jsonb_build_object(
    'kind',        'support_issue',
    'issue_id',    v_issue_id,
    'category',    coalesce(nullif(trim(p_category), ''), 'Other'),
    'description', trim(p_description)
  );

  -- Plain-text body: "[Category] description" — shown in inbox preview.
  v_body := '[' || coalesce(nullif(trim(p_category), ''), 'Other') || '] '
            || trim(p_description);

  perform public.inject_system_message(v_chat_id, v_payload, v_body);

  select * into v_chat from public.chats where chat_id = v_chat_id;
  return v_chat;
end;
$$;

grant execute on function public.rpc_submit_support_issue(text, text) to authenticated;
