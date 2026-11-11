-- 0197_rpc_unread_counts_use_auth_uid | FR-CHAT-* (security audit 2026-06-14, Finding M3)
--
-- IDOR: rpc_unread_counts_for_chats(p_viewer_id, p_chat_ids) is SECURITY DEFINER
-- and authorized against the CALLER-SUPPLIED p_viewer_id instead of auth.uid().
-- Every other chat RPC derives the actor from auth.uid(); this one trusted the
-- parameter, so a caller could pass another user's id and read that victim's
-- per-chat unread counts (an info-leak oracle for chats the victim participates
-- in). The app caller (getMyChats.ts) always passes p_viewer_id = the session
-- user, so deriving the viewer from auth.uid() is behaviour-preserving.
--
-- Fix: ignore p_viewer_id and use auth.uid() throughout. The parameter is kept
-- (rather than dropped) to preserve the function signature — the app + generated
-- database.types.ts still call it with {p_viewer_id, p_chat_ids} — but it no
-- longer influences authorization.

create or replace function public.rpc_unread_counts_for_chats(p_viewer_id uuid, p_chat_ids uuid[])
returns table(chat_id uuid, unread_count integer)
language sql
security definer
set search_path to 'public'
as $function$
  -- p_viewer_id is retained for signature compatibility but intentionally
  -- ignored; the viewer is the authenticated caller (auth.uid()).
  select m.chat_id, count(*)::int as unread_count
  from public.messages m
  where m.chat_id = any(p_chat_ids)
    and m.sender_id is distinct from auth.uid()
    and m.status <> 'read'
    and exists (
      select 1 from public.chats c
      where c.chat_id = m.chat_id
        and (c.participant_a = auth.uid() or c.participant_b = auth.uid())
    )
  group by m.chat_id;
$function$;
