-- 0134 — P2.13 — Push notification hygiene cluster (TD-73, TD-74).
--
-- Two HIGH-severity defects from the 2026-05-16 audit:
--
-- TD-73 / NOTIF-2 (follow tap routing broken)
--   The `follow_started` and `follow_approved` triggers emit
--   `params.handle = <user_uuid>::text`. The mobile route `/user/[handle]`
--   resolves the param via `findByHandle`, which queries `users.share_handle`
--   (not `user_id`). Tapping either notification lands on "user not found".
--
--   Fix: lookup `share_handle` inside the trigger and emit that. Fall back
--   to the user_id only when no share_handle is set (the route is patched
--   in PR-2 to try `findById` for UUID-shaped params).
--
-- TD-74 / NOTIF-3 (system-message push dropped ~50%)
--   `messages_enqueue_notification` falls back to `participant_a` when the
--   message has `sender_id IS NULL` (system). The closure trigger runs in
--   the post owner's session, so `auth.uid() = owner`. `enqueue_notification`
--   self-suppresses when `p_user_id = auth.uid()`. If the owner happens to
--   be `participant_a`, the fallback recipient IS the owner — self-suppressed,
--   no push goes anywhere. Roughly half the closures lose their system push
--   based purely on UUID lexicographic order of (owner, counterpart).
--
--   Fix: for system messages, iterate over both participants and enqueue
--   per-recipient. `enqueue_notification` already self-suppresses the actor
--   correctly when given the right recipient. The unique `dedupe_key` index
--   is global (not per-user), so the per-recipient key needs the recipient
--   appended to avoid the second call silently no-op'ing.
--
-- Mapped to spec: FR-NOTIF-003 (system-message push), FR-NOTIF-007/008 (follow tap routing).

begin;

-- ── TD-74: messages_enqueue_notification — emit to all non-actor participants ─

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
  v_participant   uuid;
begin
  -- Load the chat to derive recipient(s) + support-thread flag.
  select participant_a, participant_b, is_support_thread
    into v_chat
    from public.chats
   where chat_id = NEW.chat_id;

  if v_chat is null then return NEW; end if;

  v_preview := left(coalesce(NEW.body, ''), 80);

  -- ── System messages (NEW.sender_id IS NULL) ──
  -- Spec: every participant who is not the actor receives the push. The actor
  -- is auth.uid() (closure trigger runs in the owner's session; admin/cron
  -- inserts run with auth.uid() NULL — both participants get the push).
  -- enqueue_notification self-suppresses the actor; dedupe_key must include
  -- recipient because the unique index is global.
  if NEW.kind = 'system' then
    v_kind      := 'system_message';
    v_title_key := 'notifications.systemTitle';
    v_body_key  := 'notifications.systemBody';

    foreach v_participant in array array[v_chat.participant_a, v_chat.participant_b]
    loop
      if v_participant is null then continue; end if;
      v_dedupe := 'system:' || NEW.message_id::text || ':' || v_participant::text;
      perform public.enqueue_notification(
        v_participant,
        'critical',
        v_kind,
        v_title_key,
        v_body_key,
        jsonb_build_object('senderName', 'system', 'messagePreview', v_preview),
        jsonb_build_object(
          'route',   '/chat/[id]',
          'params',  jsonb_build_object('id', NEW.chat_id::text),
          'chat_id', NEW.chat_id::text
        ),
        v_dedupe,
        false
      );
    end loop;

    return NEW;
  end if;

  -- ── User messages (NEW.sender_id IS NOT NULL): notify the counterpart ──

  v_recipient := case
    when v_chat.participant_a = NEW.sender_id then v_chat.participant_b
    when v_chat.participant_b = NEW.sender_id then v_chat.participant_a
    else null
  end;

  if v_recipient is null then return NEW; end if;

  if v_chat.is_support_thread then
    v_kind      := 'support_message';
    v_title_key := 'notifications.supportTitle';
    v_body_key  := 'notifications.chatBody';
  else
    v_kind      := 'chat_message';
    v_title_key := 'notifications.chatTitle';
    v_body_key  := 'notifications.chatBody';
  end if;
  v_dedupe := 'chat:' || NEW.chat_id::text || ':' || NEW.sender_id::text || ':'
              || floor(extract(epoch from NEW.created_at) / 60)::text;

  select coalesce(display_name, 'Karma user')
    into v_sender_name
    from public.users
   where user_id = NEW.sender_id;
  v_sender_name := coalesce(v_sender_name, 'Karma user');

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

-- ── TD-73: follow_requests_enqueue_notifications — emit share_handle, not UUID ─

create or replace function public.follow_requests_enqueue_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_requester_name   text;
  v_target_name      text;
  v_target_handle    text;
begin
  -- FR-NOTIF-006: new pending request → notify the target.
  if TG_OP = 'INSERT' and NEW.status = 'pending' then
    select coalesce(display_name, 'Karma user')
      into v_requester_name
      from public.users
     where user_id = NEW.requester_id;

    perform public.enqueue_notification(
      NEW.target_id,
      'social',
      'follow_request',
      'notifications.followRequestTitle',
      'notifications.followRequestBody',
      jsonb_build_object('requesterName', coalesce(v_requester_name, 'Karma user')),
      jsonb_build_object('route', '/settings/follow-requests'),
      'follow_req:' || NEW.requester_id::text || ':' || NEW.target_id::text,
      false
    );

  -- FR-NOTIF-008: request accepted → notify the requester.
  elsif TG_OP = 'UPDATE' and NEW.status = 'accepted' and OLD.status <> 'accepted' then
    select coalesce(display_name, 'Karma user'), share_handle
      into v_target_name, v_target_handle
      from public.users
     where user_id = NEW.target_id;

    perform public.enqueue_notification(
      NEW.requester_id,
      'social',
      'follow_approved',
      'notifications.followApprovedTitle',
      'notifications.followApprovedBody',
      jsonb_build_object('targetName', coalesce(v_target_name, 'Karma user')),
      jsonb_build_object(
        'route',  '/user/[handle]',
        'params', jsonb_build_object('handle', coalesce(v_target_handle, NEW.target_id::text))
      ),
      'follow_appr:' || NEW.requester_id::text || ':' || NEW.target_id::text,
      false
    );
  end if;

  return NEW;
end $$;

-- ── TD-73: follow_edges_enqueue_started — emit share_handle, not UUID ─

create or replace function public.follow_edges_enqueue_started()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_follower_name   text;
  v_follower_handle text;
begin
  select coalesce(display_name, 'Karma user'), share_handle
    into v_follower_name, v_follower_handle
    from public.users
   where user_id = NEW.follower_id;

  -- No dedupe_key: dispatcher's ≥3-in-60min coalescing handles FR-NOTIF-007 AC3.
  -- follow_edges has no 'source' column; trigger fires on every insert.
  -- For approved-request follows, follow_requests_enqueue already notified
  -- the requester (FR-NOTIF-008); here we notify the followee.
  perform public.enqueue_notification(
    NEW.followed_id,
    'social',
    'follow_started',
    'notifications.followStartedTitle',
    'notifications.followStartedBody',
    jsonb_build_object('followerName', coalesce(v_follower_name, 'Karma user')),
    jsonb_build_object(
      'route',  '/user/[handle]',
      'params', jsonb_build_object('handle', coalesce(v_follower_handle, NEW.follower_id::text))
    ),
    null,
    false
  );

  return NEW;
end $$;

commit;
