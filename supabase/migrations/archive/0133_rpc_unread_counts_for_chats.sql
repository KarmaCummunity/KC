-- 0133 — PERF-5 Shipment 2 (partial): per-chat unread count RPC.
--
-- Inbox today (`getMyChats.ts`) loads its unread badges by SELECTing every
-- non-read message across every chat the viewer is in, then counting
-- client-side. For a power user with thousands of messages across dozens of
-- chats this transfers tens of MB just to render a small integer per row.
--
-- This RPC computes the counts server-side using the existing partial index
-- `messages_chat_unread_idx (chat_id) where status <> 'read'` (created in
-- migration 0004). Payload: at most one row per chat with ≥1 unread message.
--
-- SECURITY DEFINER + explicit participant predicate replicates the RLS
-- predicate `is_chat_visible_to(chat_id, viewer)` (chat is visible iff viewer
-- is participant_a OR participant_b). Without this guard the function would
-- leak unread counts of arbitrary chats.
--
-- Unread semantics mirror the FE counter exactly:
--   - status <> 'read'   (covers 'pending', 'sent', 'delivered')
--   - sender IS DISTINCT FROM viewer (system messages with sender_id = NULL
--     and counterpart messages both count; viewer's own messages do not)
--
-- Mapped to spec: PERF-5 (DB consolidation, inbox path).

create or replace function public.rpc_unread_counts_for_chats(
  p_viewer_id uuid,
  p_chat_ids uuid[]
)
returns table(chat_id uuid, unread_count int)
language sql
security definer
set search_path = public
as $$
  select m.chat_id, count(*)::int as unread_count
  from public.messages m
  where m.chat_id = any(p_chat_ids)
    and m.sender_id is distinct from p_viewer_id
    and m.status <> 'read'
    and exists (
      select 1 from public.chats c
      where c.chat_id = m.chat_id
        and (c.participant_a = p_viewer_id or c.participant_b = p_viewer_id)
    )
  group by m.chat_id;
$$;

revoke all on function public.rpc_unread_counts_for_chats(uuid, uuid[]) from public;
grant execute on function public.rpc_unread_counts_for_chats(uuid, uuid[]) to authenticated;

comment on function public.rpc_unread_counts_for_chats(uuid, uuid[]) is
  'PERF-5: returns per-chat unread counts for the viewer in one round-trip. '
  'Replaces the client-side fan-out in getMyChats.ts. SECURITY DEFINER with '
  'explicit participant guard mirrors is_chat_visible_to.';
