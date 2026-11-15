-- 0031_post_closure_emit_system_messages | P1.2 — FR-CHAT-015 / FR-CLOSURE-001 ext.
--
-- AFTER UPDATE OF status ON posts: for transitions open → closed_delivered or
-- open → deleted_no_recipient, find every chat anchored to this post and
-- insert a `system` message describing the outcome. The chat used for the
-- close (whose non-owner participant equals the recipient) gets the "thanks"
-- text; sibling chats get the neutral "delivered to someone else" text. For
-- the no-recipient path, all anchored chats get the same text.
--
-- The trigger is the single source of truth — fires whether the close came
-- from close_post_with_recipient (RPC) or a plain client UPDATE (no-recipient
-- path). Reopen, admin removal, expiration, and any other transition are NO-OPs
-- (early return).
--
-- system_payload schema (forward-compat for future UI cards):
--   { kind: 'post_closed', post_id: uuid, status: text,
--     recipient_user_id: uuid|null }
-- Only the recipient's own chat carries a non-null recipient_user_id, to
-- avoid leaking the recipient's identity to siblings.
--
-- Hebrew body text matches FR-CHAT-015 AC4-AC6.

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
  -- Only act on the two transitions the spec covers. Anything else (reopen,
  -- removed_admin, expired, no actual status change) → no-op.
  if not (
    old.status = 'open'
    and new.status in ('closed_delivered', 'deleted_no_recipient')
  ) then
    return new;
  end if;

  -- For the delivered path, the recipients row was inserted earlier in the
  -- same transaction by close_post_with_recipient in 0015_closure_rpcs.sql —
  -- the INSERT runs before the UPDATE, so the row is visible to this AFTER trigger.
  if new.status = 'closed_delivered' then
    -- recipients.post_id is the PK (0002 L162) — exactly one row guaranteed by
    -- the time this AFTER trigger fires (close_post_with_recipient INSERTs the
    -- row before the UPDATE in the same transaction). STRICT fails loudly if
    -- that invariant is ever broken, rather than silently mislabeling all
    -- anchored chats as siblings.
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
      -- Defensive: posts.owner_id is immutable today and chats anchored to a post
      -- always include the owner as one participant. Skip if data drift ever
      -- breaks that invariant rather than emit a misdirected message.
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

  return new;
end;
$$;

drop trigger if exists posts_after_update_emit_closure_messages on public.posts;
create trigger posts_after_update_emit_closure_messages
  after update of status on public.posts
  for each row execute function public.posts_emit_closure_system_messages();

-- end of 0031_post_closure_emit_system_messages
