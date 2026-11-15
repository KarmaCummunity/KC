-- 0200_rpc_require_active_member | TD-87 — suspended/banned users can still mutate via RPCs
--
-- 0072 established that INSERT paths require an active account, and 0183 (D-57)
-- extended that to report inserts. But six SECURITY DEFINER mutation RPCs never
-- re-checked membership, so a suspended_admin / suspended_for_false_reports /
-- banned / pending_verification user could still drive closure, reopen, recipient
-- unmark, and chat-anchor changes by calling the RPC directly:
--   • close_post_with_recipient            (open → closed_delivered)
--   • reopen_post_marked                   (closed_delivered → open)
--   • reopen_post_deleted_no_recipient     (deleted_no_recipient → open)
--   • rpc_recipient_unmark_self            (recipient drops their credit)
--   • rpc_chat_set_anchor                  (sets a chat's anchored post)
--   • rpc_submit_support_issue             (in-app support form)
--
-- Fix: gate each on `is_active_member(auth.uid())` (the same STABLE SECURITY
-- DEFINER helper 0072/0183 use), raising `account_not_active` (errcode P0001 —
-- NOT 42501, which `mapClosurePgError` maps to `followers_only_requires_private`).
-- Bodies are otherwise the current canonical definitions (the three closure/reopen
-- RPCs as of 0199, the others as of 0156 / 0027 / 0074); the only change is the
-- added guard right after the existing caller-identity check.
--
-- Note on appeals: the account-blocked screen routes support to a `mailto:`
-- (app/apps/mobile/app/account-blocked.tsx), NOT this RPC, so gating
-- rpc_submit_support_issue does not remove a non-active user's recourse channel.
--
-- Mapped to spec: FR-MOD-004/005 (suspension/ban semantics), FR-CLOSURE-001..007,
--   FR-CHAT-014/015. No new ACs.

set search_path = public;

-- 1. close_post_with_recipient (canonical: 0199, DEFINER) — + active-member gate.
create or replace function public.close_post_with_recipient(p_post_id uuid, p_recipient_user_id uuid)
returns public.posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner   uuid;
  v_status  text;
  v_post    public.posts;
  v_user_ok boolean;
begin
  select owner_id, status into v_owner, v_status
    from public.posts
   where post_id = p_post_id
   for update;

  if v_owner is null then
    raise exception 'closure_wrong_status' using errcode = 'P0001';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'closure_not_owner' using errcode = 'P0001';
  end if;
  if not public.is_active_member(auth.uid()) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;
  if v_status <> 'open' then
    raise exception 'closure_wrong_status' using errcode = 'P0001';
  end if;

  if v_owner = p_recipient_user_id then
    raise exception 'closure_recipient_not_in_chat' using errcode = 'P0001';
  end if;

  select exists (select 1 from public.users where user_id = p_recipient_user_id)
    into v_user_ok;
  if not v_user_ok then
    raise exception 'closure_recipient_not_in_chat' using errcode = 'P0001';
  end if;

  insert into public.recipients (post_id, recipient_user_id)
       values (p_post_id, p_recipient_user_id);

  update public.posts
     set status = 'closed_delivered',
         delete_after = null,
         updated_at = now()
   where post_id = p_post_id
   returning * into v_post;

  return v_post;
end;
$$;

-- 2. reopen_post_marked (canonical: 0199, DEFINER) — + active-member gate.
create or replace function public.reopen_post_marked(p_post_id uuid)
returns public.posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner   uuid;
  v_status  text;
  v_post    public.posts;
begin
  select owner_id, status into v_owner, v_status
    from public.posts
   where post_id = p_post_id
   for update;

  if v_owner is null then
    raise exception 'closure_wrong_status' using errcode = 'P0001';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'closure_not_owner' using errcode = 'P0001';
  end if;
  if not public.is_active_member(auth.uid()) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;
  if v_status <> 'closed_delivered' then
    raise exception 'closure_wrong_status' using errcode = 'P0001';
  end if;

  delete from public.recipients where post_id = p_post_id;

  update public.posts
     set status = 'open',
         reopen_count = reopen_count + 1,
         delete_after = null,
         updated_at = now()
   where post_id = p_post_id
   returning * into v_post;

  return v_post;
end;
$$;

-- 3. reopen_post_deleted_no_recipient (canonical: 0199, DEFINER) — + active-member gate.
create or replace function public.reopen_post_deleted_no_recipient(p_post_id uuid)
returns public.posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner   uuid;
  v_status  text;
  v_post    public.posts;
begin
  select owner_id, status into v_owner, v_status
    from public.posts
   where post_id = p_post_id
   for update;

  if v_owner is null then
    raise exception 'closure_wrong_status' using errcode = 'P0001';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'closure_not_owner' using errcode = 'P0001';
  end if;
  if not public.is_active_member(auth.uid()) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;
  if v_status <> 'deleted_no_recipient' then
    raise exception 'closure_wrong_status' using errcode = 'P0001';
  end if;

  update public.posts
     set status = 'open',
         reopen_count = reopen_count + 1,
         delete_after = null,
         updated_at = now()
   where post_id = p_post_id
   returning * into v_post;

  return v_post;
end;
$$;

-- 4. rpc_recipient_unmark_self (canonical: 0156, DEFINER) — + active-member gate.
create or replace function public.rpc_recipient_unmark_self(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller   uuid    := auth.uid();
  v_owner_id uuid;
  v_post_type text;
begin
  if v_caller is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not public.is_active_member(v_caller) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;

  -- Verify caller is the active recipient and post is closed_delivered.
  select p.owner_id, p.type
    into v_owner_id, v_post_type
    from public.posts p
    join public.recipients r on r.post_id = p.post_id
   where p.post_id   = p_post_id
     and p.status    = 'closed_delivered'
     and r.recipient_user_id = v_caller;

  if not found then
    raise exception 'not_recipient_or_wrong_status' using errcode = 'P0001';
  end if;

  -- Delete recipient row (triggers fire: items_received -1 + notification to owner).
  delete from public.recipients
   where post_id = p_post_id
     and recipient_user_id = v_caller;

  -- Note: owner counter is intentionally NOT decremented here (TD-71). The
  -- post remains inside the closed/deleted-no-recipient set, so the owner's
  -- items_given (Give) or items_received (Request) credit must stay. The
  -- counter is decremented when the owner reopens
  -- (reopen_post_deleted_no_recipient → posts_after_change_counters fires).

  -- Transition post to deleted_no_recipient, give owner 7 days to reopen/re-mark.
  update public.posts
     set status       = 'deleted_no_recipient',
         delete_after = now() + interval '7 days'
   where post_id = p_post_id;

  -- Audit trail.
  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (
    v_caller,
    'unmark_recipient_self',
    'post',
    p_post_id,
    jsonb_build_object('owner_id', v_owner_id, 'post_type', v_post_type)
  );
end $$;

-- 5. rpc_chat_set_anchor (canonical: 0164, DEFINER) — + active-member gate.
create or replace function public.rpc_chat_set_anchor(p_chat_id uuid, p_anchor_post_id uuid)
returns public.chats
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.chats;
  v_post public.posts;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;
  if not public.is_active_member(v_uid) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;

  select * into v_row
  from public.chats
  where chat_id = p_chat_id;

  if v_row.chat_id is null then
    raise exception 'chat_not_found' using errcode = 'P0001';
  end if;

  if v_row.participant_a <> v_uid and v_row.participant_b <> v_uid then
    raise exception 'not_participant' using errcode = 'P0001';
  end if;

  select * into v_post
  from public.posts
  where post_id = p_anchor_post_id;

  if v_post.post_id is null then
    raise exception 'post_not_found' using errcode = 'P0001';
  end if;

  if not public.is_post_visible_to(v_post, v_uid) then
    raise exception 'post_not_visible' using errcode = 'P0001';
  end if;

  if v_row.anchor_post_id is not distinct from p_anchor_post_id then
    return v_row;
  end if;

  update public.chats
     set anchor_post_id = p_anchor_post_id
   where chat_id = p_chat_id
  returning * into v_row;

  return v_row;
end;
$$;

-- 6. rpc_submit_support_issue (canonical: 0074, DEFINER) — + active-member gate.
--    Appeals use the account-blocked mailto, not this RPC (see header).
create or replace function public.rpc_submit_support_issue(p_category text, p_description text)
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
  if not public.is_active_member(v_uid) then
    raise exception 'account_not_active' using errcode = 'P0001';
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
