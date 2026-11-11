-- 0136 — P2.13 MOD-2 (TD-77) — Critical notification on chat auto-removal.
--
-- Audit finding: `chats.removed_at = now()` makes `is_chat_visible_to` return
-- false for both parties, so the chat disappears entirely from inbox +
-- transcript. There's no banner UI and no system message — both participants
-- see the thread silently vanish. The `auto_removed` system bubble only lands
-- in the 3rd reporter's support thread (audit MOD-22, separately tracked).
--
-- This trigger fires when `chats.removed_at` flips from NULL to non-NULL and
-- enqueues a Critical notification to each non-NULL participant. They learn
-- their conversation was removed, with `bypass_preferences: true` so it
-- delivers even to users who disabled Critical.
--
-- A proper in-app banner UI for hidden removed chats is a separate FE
-- concern; this BE fix closes the "silent vanish" defect. Per-recipient
-- dedupe_key uses `chat_id + recipient` so both participants get one push.
--
-- Mapped to spec: FR-MOD-005 AC2 (chat auto-removal user-facing signal).

begin;

create or replace function public.chats_enqueue_auto_removed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_participant   uuid;
begin
  -- Only fire on the NULL → non-NULL transition (idempotent on retries).
  if NEW.removed_at is null then return NEW; end if;
  if OLD.removed_at is not null then return NEW; end if;

  foreach v_participant in array array[NEW.participant_a, NEW.participant_b]
  loop
    if v_participant is null then continue; end if;
    perform public.enqueue_notification(
      v_participant,
      'critical',
      'chat_auto_removed',
      'notifications.chatAutoRemovedTitle',
      'notifications.chatAutoRemovedBody',
      '{}'::jsonb,
      jsonb_build_object('route', '/'),
      'chat_auto_removed:' || NEW.chat_id::text || ':' || v_participant::text,
      true   -- bypass_preferences: user has a right to know their chat was removed
    );
  end loop;

  return NEW;
end $$;

drop trigger if exists tg_chats_enqueue_auto_removed on public.chats;
create trigger tg_chats_enqueue_auto_removed
  after update of removed_at on public.chats
  for each row
  execute function public.chats_enqueue_auto_removed();

commit;
