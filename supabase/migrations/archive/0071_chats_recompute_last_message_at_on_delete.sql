-- ─────────────────────────────────────────────
-- Migration 0071 — TD-58 / FR-CHAT-005
-- Recompute `chats.last_message_at` after a message DELETE.
--
-- Problem: `chats_bump_last_message_at` (migration 0004 §7) only fires on
-- INSERT, so after `admin_delete_message` (migration 0037) removes the
-- newest message, the chat row keeps sorting at the deleted message's
-- timestamp until a fresh message lands. The inbox order then misleads
-- the user (and the admin).
--
-- Fix: AFTER DELETE on `public.messages` — for the affected `chat_id`,
-- set `last_message_at` to `MAX(created_at)` of the remaining messages,
-- falling back to the chat's own `created_at` when the chat is empty.
--
-- SECURITY DEFINER mirrors the existing INSERT trigger pattern so the
-- update bypasses the no-direct-UPDATE policy on `chats`.
--
-- Idempotent: safe to re-apply (CREATE OR REPLACE FUNCTION + DROP +
-- CREATE TRIGGER).
-- ─────────────────────────────────────────────

create or replace function public.chats_recompute_last_message_at_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chats c
  set last_message_at = coalesce(
    (select max(created_at) from public.messages where chat_id = old.chat_id),
    c.created_at
  )
  where c.chat_id = old.chat_id;
  return old;
end;
$$;

drop trigger if exists messages_after_delete_recompute_chat on public.messages;

create trigger messages_after_delete_recompute_chat
  after delete on public.messages
  for each row execute function public.chats_recompute_last_message_at_after_delete();
