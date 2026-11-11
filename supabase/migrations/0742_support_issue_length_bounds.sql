-- 0742_support_issue_length_bounds | #2096, FR-MOD-002 AC6: the server caps a support-issue
-- description at 500 characters after trim.
--
-- The report-a-problem form stops typing at 500 characters, but `rpc_submit_support_issue`
-- (latest body 0452) checked only the 10-character minimum, so any other client could store
-- an unbounded report in the support thread. Same body as 0452, including its D61 gate (a
-- suspended member may still contact support), plus the upper bound; the description is
-- trimmed once and both bounds read the trimmed text.

begin;

create or replace function public.rpc_submit_support_issue(p_category text, p_description text)
returns public.chats
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_chat_id     uuid;
  v_issue_id    uuid := gen_random_uuid();
  v_description text := trim(coalesce(p_description, ''));
  v_category    text := coalesce(nullif(trim(p_category), ''), 'Other');
  v_payload     jsonb;
  v_body        text;
  v_chat        public.chats;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = 'check_violation';
  end if;
  -- D61 (0452): support stays reachable for a suspended member, unlike the other member RPCs.
  if not public.can_contact_support(v_uid) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;

  -- FR-MOD-002 AC1 / AC6: 10–500 visible characters (the client applies the same bounds).
  if length(v_description) < 10 then
    raise exception 'description_too_short' using errcode = 'check_violation';
  end if;
  if length(v_description) > 500 then
    raise exception 'description_too_long' using errcode = 'check_violation';
  end if;

  -- Get or create the support thread (the internal helper from 0005, made atomic in 0184).
  v_chat_id := public.find_or_create_support_chat(v_uid);

  -- Structured payload so SupportIssueBubble can render it richly.
  v_payload := jsonb_build_object(
    'kind',        'support_issue',
    'issue_id',    v_issue_id,
    'category',    v_category,
    'description', v_description
  );

  -- Plain-text body "[Category] description", shown in the inbox preview.
  v_body := '[' || v_category || '] ' || v_description;

  perform public.inject_system_message(v_chat_id, v_payload, v_body);

  select * into v_chat from public.chats where chat_id = v_chat_id;
  return v_chat;
end;
$$;

comment on function public.rpc_submit_support_issue(text, text) is
  'FR-MOD-002: files a support issue (10–500 characters after trim) as a system message in the '
  'caller''s support thread and returns the thread.';

commit;
