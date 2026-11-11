-- Messaging · messages and reactions
--
-- A message is written once and never changes: there is no edit and no delete from a device
-- (the spec has neither; removal by a moderator arrives with the moderation module). Rows
-- are inserted only by server code — `public.send_message` for members,
-- `kc_private.chat_post_system_message` for the product — so the rules that need a stable
-- error for the app (blocked pair, inactive account, retry of the same message) live in
-- one place and a system message can never be forged.

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  chat_id         uuid not null references public.chats (id) on delete cascade,
  -- Null for a system message, and for a message whose sender's account was removed: the
  -- other member keeps the text, shown as from a deleted user (FR-CHAT-013, design §4.1).
  sender_id       uuid references public.users (id) on delete set null,
  kind            text not null default 'user',
  body            text,
  -- System message: `{ "kind": "<snake_case>", … }`. The app renders the text from it, so
  -- no user-visible wording is stored here.
  system_payload  jsonb,
  -- Media message: `{ "type": "image" | "video" | "voice" | "location" | "post_share", … }`.
  media_payload   jsonb,
  -- Detected BCP 47 language of the body; written by the translation pipeline.
  source_language text check (char_length(source_language) between 2 and 35),
  -- Assigned by trigger, strictly increasing inside a chat (see messages_stamp below).
  created_at      timestamptz not null default clock_timestamp(),
  -- The one shape rule: what each kind must and must not carry (FR-CHAT-002 AC5: 2,000).
  -- `coalesce` makes a missing value fail the rule instead of leaving it undecided.
  constraint messages_shape_chk check (coalesce(
    case kind
      when 'user' then
        char_length(body) between 1 and 2000 and system_payload is null and media_payload is null
      when 'media' then
        coalesce(char_length(body), 1) between 1 and 2000 and system_payload is null
        and jsonb_typeof(media_payload) = 'object'
        and media_payload ->> 'type' in ('image', 'video', 'voice', 'location', 'post_share')
      when 'system' then
        body is null and media_payload is null and sender_id is null
        and jsonb_typeof(system_payload) = 'object'
        and jsonb_typeof(system_payload -> 'kind') = 'string'
      else false
    end, false))
);
comment on table public.messages is 'Chat messages. Immutable; read state is chat_members.last_read_at.';

-- The one index of the chat screens: a page of a chat (keyset on created_at), the newest
-- message of a chat for the inbox preview, and the unread count
-- (`chat_id = … and created_at > last_read_at`). Unique because the stamp trigger makes
-- created_at strictly increasing inside a chat, which is what lets a single timestamp be
-- the page cursor and the read marker.
create unique index messages_chat_created_uidx on public.messages (chat_id, created_at desc);
-- Foreign key on sender_id (account removal).
create index messages_sender_idx on public.messages (sender_id) where sender_id is not null;

-- Gives the message its time and moves the chat's `last_message_at` to it. The update takes
-- the chat's row lock, so writers of one chat queue up and each gets a time later than the
-- one before it, in commit order. A reader who marks the chat read up to `last_message_at`
-- therefore never skips a message that commits afterwards.
create function kc_private.messages_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chats c
     set last_message_at = greatest(clock_timestamp(), c.last_message_at + interval '1 microsecond')
   where c.id = new.chat_id
  returning c.last_message_at into new.created_at;
  return new;
end;
$$;
comment on function kc_private.messages_stamp() is
  'BEFORE INSERT on messages: assigns a per-chat increasing created_at and advances chats.last_message_at.';

create trigger messages_stamp
  before insert on public.messages
  for each row execute function kc_private.messages_stamp();

-- What follows from a new message, of any kind:
--   1. the chat returns to the inbox of every member who had removed it (FR-CHAT-016 AC5)
--   2. one `notification` event per other member (FR-NOTIF-001/002/003, FR-CHAT-003 AC4).
--      A member blocked with the sender gets none. The event carries ids only — the
--      worker reads the preview text when it builds the push — so no message text is ever
--      copied into the queue.
create function kc_private.messages_apply_effects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chat public.chats;
  v_to uuid;
begin
  update public.chat_members cm
     set hidden_at = null
   where cm.chat_id = new.chat_id and cm.hidden_at is not null;

  select c.* into v_chat from public.chats c where c.id = new.chat_id;
  for v_to in
    select cm.user_id
      from public.chat_members cm
     where cm.chat_id = new.chat_id
       and cm.user_id is distinct from new.sender_id
       and not kc_access.is_blocked_between(cm.user_id, new.sender_id)
  loop
    perform kc_private.outbox_enqueue('notification', jsonb_build_object(
      'kind', case
                when new.kind = 'system' then 'system_message'
                -- An answer from the support team to the member the thread belongs to.
                when v_chat.kind = 'support' and v_to = v_chat.support_user_id then 'support_message'
                else 'chat_message'
              end,
      'recipient_id', v_to,
      'actor_id', new.sender_id,
      'entity', jsonb_build_object('type', 'chat', 'id', new.chat_id),
      'data', jsonb_build_object('message_id', new.id, 'message_kind', new.kind)));
  end loop;
  return null;
end;
$$;
comment on function kc_private.messages_apply_effects() is
  'AFTER INSERT on messages: un-hides the chat for its members and enqueues their notifications.';

create trigger messages_apply_effects
  after insert on public.messages
  for each row execute function kc_private.messages_apply_effects();

alter table public.messages enable row level security;
alter table public.messages force row level security;

-- Members of the chat read its messages; a block that closes the chat closes them too.
create policy messages_select_member on public.messages
  for select to authenticated
  using (kc_access.can_access_chat(chat_id));

grant select on public.messages to authenticated;

-- ── Reactions ───────────────────────────────────────────────────────────────
-- One reaction per member per message; set and cleared through set_message_reaction.
create table public.message_reactions (
  message_id    uuid not null references public.messages (id) on delete cascade,
  user_id       uuid not null references public.users (id) on delete cascade,
  reaction_type text not null check (reaction_type in ('like', 'love', 'laugh', 'sad')),
  created_at    timestamptz not null default now(),
  primary key (message_id, user_id)
);
comment on table public.message_reactions is 'A member''s reaction to a chat message.';

-- Foreign key on user_id (account removal).
create index message_reactions_user_idx on public.message_reactions (user_id);

alter table public.message_reactions enable row level security;
alter table public.message_reactions force row level security;

-- Visible exactly when the message is: the subquery runs under the caller's own access to
-- `messages`.
create policy message_reactions_select_member on public.message_reactions
  for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_reactions.message_id));

grant select on public.message_reactions to authenticated;
