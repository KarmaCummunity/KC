-- 0026_chat_anchor_lifecycle | P1.2.x — FR-CHAT-014 / FR-CLOSURE-001 ext.
--
-- Extends posts_emit_closure_system_messages (defined in 0021) to additionally
-- clear chats.anchor_post_id for every chat anchored to the post being closed.
-- This makes the chat "free" so a subsequent contact-poster from a different
-- post re-anchors cleanly (paired with the adapter fix in
-- SupabaseChatRepository.findOrCreateChat).
--
-- The clear runs AFTER the system-message inserts so the SELECT in the loop
-- still finds the anchored chats.

set search_path = public;

create or replace function public.posts_emit_closure_system_messages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient   uuid;
  v_chat        record;
  v_other       uuid;
  v_is_recipient_chat boolean;
  v_body        text;
  v_payload     jsonb;
begin
  if not (
    old.status = 'open'
    and new.status in ('closed_delivered', 'deleted_no_recipient')
  ) then
    return new;
  end if;

  if new.status = 'closed_delivered' then
    select recipient_user_id into strict v_recipient
    from public.recipients
    where post_id = new.post_id;
  else
    v_recipient := null;
  end if;

  for v_chat in
    select chat_id, participant_a, participant_b
    from public.chats
    where anchor_post_id = new.post_id
  loop
    if v_chat.participant_a <> new.owner_id and v_chat.participant_b <> new.owner_id then
      continue;
    end if;

    v_other := case
      when v_chat.participant_a = new.owner_id then v_chat.participant_b
      else v_chat.participant_a
    end;

    v_is_recipient_chat := (v_recipient is not null and v_other = v_recipient);

    if new.status = 'closed_delivered' then
      if v_is_recipient_chat then
        v_body := 'הפוסט סומן כנמסר ✓ · תודה!';
      else
        v_body := 'הפוסט נמסר למשתמש אחר';
      end if;
    else
      v_body := 'המפרסם סגר את הפוסט — הפריט לא נמסר';
    end if;

    v_payload := jsonb_build_object(
      'kind',              'post_closed',
      'post_id',           new.post_id,
      'status',            new.status,
      'recipient_user_id', case when v_is_recipient_chat then v_recipient else null end
    );

    insert into public.messages (
      chat_id, sender_id, kind, body, system_payload, status, delivered_at
    ) values (
      v_chat.chat_id, null, 'system', v_body, v_payload, 'delivered', now()
    );
  end loop;

  -- NEW in 0026: clear the anchor for every chat that pointed to this post,
  -- so a future contact-poster from a different post re-anchors cleanly.
  -- Runs after the loop above so the SELECT in the loop still sees the
  -- anchored rows.
  update public.chats
     set anchor_post_id = null
   where anchor_post_id = new.post_id;

  return new;
end;
$$;

-- end of 0026_chat_anchor_lifecycle
