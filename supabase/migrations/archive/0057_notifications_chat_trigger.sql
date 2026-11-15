-- 0057_notifications_chat_trigger | P1.5 — FR-NOTIF-001/002/003.
-- Single trigger on messages handles three FRs:
--   • user message in a regular chat        → FR-NOTIF-001 (chat_message)
--   • user message in a support thread      → FR-NOTIF-002 (support_message)
--   • system message in any chat            → FR-NOTIF-003 (system_message)
-- Support threads are identified via chats.is_support_thread (cheaper than
-- querying users.is_super_admin per message). Self-suppression is handled
-- inside enqueue_notification via auth.uid() check.

create or replace function public.messages_enqueue_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_chat          record;
  v_recipient     uuid;
  v_kind          text;
  v_title_key     text;
  v_body_key      text;
  v_dedupe        text;
  v_preview       text;
  v_sender_name   text;
begin
  -- Load the chat to derive recipient and support-thread flag.
  select participant_a, participant_b, is_support_thread
    into v_chat
    from public.chats
   where chat_id = NEW.chat_id;

  if v_chat is null then return NEW; end if;

  -- Derive recipient: the participant who is NOT the sender.
  v_recipient := case
    when v_chat.participant_a = NEW.sender_id then v_chat.participant_b
    when v_chat.participant_b = NEW.sender_id then v_chat.participant_a
    else null
  end;

  -- System messages may have sender_id = null. Fall back to participant_a
  -- (server-side inserts always know who the target is, but the trigger has
  -- no better signal; participant_a is the non-admin in support threads).
  if v_recipient is null and NEW.kind = 'system' then
    v_recipient := v_chat.participant_a;
  end if;

  if v_recipient is null then return NEW; end if;

  -- Resolve notification kind, title key, and deduplication window.
  if NEW.kind = 'system' then
    v_kind      := 'system_message';
    v_title_key := 'notifications.systemTitle';
    v_body_key  := 'notifications.systemBody';
    v_dedupe    := 'system:' || NEW.message_id::text;
  elsif v_chat.is_support_thread then
    v_kind      := 'support_message';
    v_title_key := 'notifications.supportTitle';
    v_body_key  := 'notifications.chatBody';
    v_dedupe    := 'chat:' || NEW.chat_id::text || ':' || NEW.sender_id::text || ':'
                   || floor(extract(epoch from NEW.created_at) / 60)::text;
  else
    v_kind      := 'chat_message';
    v_title_key := 'notifications.chatTitle';
    v_body_key  := 'notifications.chatBody';
    v_dedupe    := 'chat:' || NEW.chat_id::text || ':' || NEW.sender_id::text || ':'
                   || floor(extract(epoch from NEW.created_at) / 60)::text;
  end if;

  -- Sender display name (null-safe for system messages).
  if NEW.sender_id is not null then
    select coalesce(display_name, 'Karma user')
      into v_sender_name
      from public.users
     where user_id = NEW.sender_id;
  end if;
  v_sender_name := coalesce(v_sender_name, 'system');

  v_preview := left(coalesce(NEW.body, ''), 80);

  perform public.enqueue_notification(
    v_recipient,
    'critical',
    v_kind,
    v_title_key,
    v_body_key,
    jsonb_build_object('senderName', v_sender_name, 'messagePreview', v_preview),
    jsonb_build_object(
      'route',   '/chat/[id]',
      'params',  jsonb_build_object('id', NEW.chat_id::text),
      'chat_id', NEW.chat_id::text
    ),
    v_dedupe,
    false
  );

  return NEW;
end $$;

drop trigger if exists tg_messages_enqueue_notification on public.messages;
create trigger tg_messages_enqueue_notification
  after insert on public.messages
  for each row
  execute function public.messages_enqueue_notification();
