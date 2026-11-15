-- Messaging · chats and their members (docs/db/target-design.md §3.5)
--
-- A chat is a conversation; who takes part is a row per member in `chat_members`, which also
-- holds everything that is personal to that member: how far they have read and whether they
-- removed the chat from their own inbox. Two kinds exist today:
--   direct   exactly two members, one chat per pair (D13, D126), optionally pinned to a post
--   support  a member's thread with the support team (FR-CHAT-007); staff join as members
-- A group or organizer chat is one more `kind` with any number of member rows: nothing in
-- this module assumes two members except the columns named `direct_*`.

create table public.chats (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('direct', 'support')),
  -- The pair of a direct chat, ordered (a < b), so that one unique index guarantees a single
  -- chat per pair whoever opens it first. A member who leaves the product leaves a null:
  -- the other member keeps the thread (FR-CHAT-013) and a new account never inherits it.
  direct_user_a   uuid references public.users (id) on delete set null,
  direct_user_b   uuid references public.users (id) on delete set null,
  -- The member a support thread belongs to.
  support_user_id uuid references public.users (id) on delete set null,
  -- The post the conversation is about right now (D13, FR-CHAT-014). The last entry from a
  -- post wins; closing the post clears it (050_chat_system_messages.sql).
  anchor_post_id  uuid references public.posts (id) on delete set null,
  -- Time of the newest message; null until the first one. Orders the inbox and is the
  -- value a member's read marker advances to.
  last_message_at timestamptz,
  created_at      timestamptz not null default now(),
  constraint chats_direct_pair_chk
    check (kind = 'direct' or (direct_user_a is null and direct_user_b is null)),
  constraint chats_direct_order_chk check (direct_user_a < direct_user_b),
  constraint chats_support_user_chk check (kind = 'support' or support_user_id is null),
  constraint chats_anchor_chk check (kind = 'direct' or anchor_post_id is null)
);
comment on table public.chats is 'Conversations. Membership and per-member state live in chat_members.';

-- One direct chat per pair; also the lookup of open_direct_chat and the foreign key on
-- direct_user_a.
create unique index chats_direct_pair_uidx on public.chats (direct_user_a, direct_user_b)
  where kind = 'direct';
-- Foreign key on direct_user_b (account removal).
create index chats_direct_user_b_idx on public.chats (direct_user_b) where direct_user_b is not null;
-- One support thread per member; also the foreign key on support_user_id.
create unique index chats_support_user_uidx on public.chats (support_user_id) where kind = 'support';
-- Chats pinned to a post: the closing line written when the post closes; also the foreign key.
create index chats_anchor_post_idx on public.chats (anchor_post_id) where anchor_post_id is not null;

create table public.chat_members (
  chat_id      uuid not null references public.chats (id) on delete cascade,
  user_id      uuid not null references public.users (id) on delete cascade,
  -- 'support_agent' marks staff in a support thread.
  role         text not null default 'member' check (role in ('member', 'support_agent')),
  -- Read marker: every message created after it and not sent by the member is unread.
  -- There is no per-message read state (state-machines.md §7 Q3).
  last_read_at timestamptz not null default now(),
  -- Set when the member removed the chat from their own inbox (FR-CHAT-016); cleared by
  -- the next message in the chat or when the member opens the chat again.
  hidden_at    timestamptz,
  joined_at    timestamptz not null default now(),
  primary key (chat_id, user_id)
);
comment on table public.chat_members is
  'Members of a chat with their personal state: read marker and inbox hide.';

-- A member's chats: inbox page and unread counters; also the foreign key on user_id.
create index chat_members_user_idx on public.chat_members (user_id, chat_id);

-- Membership follows the kind of the chat: a direct chat holds only its pair, and the only
-- plain member of a support thread is the member it belongs to.
create function kc_private.chat_members_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_chat public.chats;
begin
  select c.* into v_chat from public.chats c where c.id = new.chat_id;
  if (v_chat.kind = 'direct' and new.user_id not in (v_chat.direct_user_a, v_chat.direct_user_b))
     or (v_chat.kind = 'direct' and new.role <> 'member')
     or (v_chat.kind = 'support'
         and (new.role = 'member') <> (new.user_id is not distinct from v_chat.support_user_id)) then
    raise exception 'chat_member_not_allowed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
comment on function kc_private.chat_members_guard() is
  'BEFORE INSERT on chat_members: a direct chat admits only its pair; a support thread one plain member.';

create trigger chat_members_guard
  before insert on public.chat_members
  for each row execute function kc_private.chat_members_guard();

-- A chat nobody is a member of any more is removed with its messages: this happens when
-- the last member's account is purged (design §4.1).
create function kc_private.chat_members_remove_empty_chats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.chats c
   where c.id in (select o.chat_id from old_rows o)
     and not exists (select 1 from public.chat_members cm where cm.chat_id = c.id);
  return null;
end;
$$;
comment on function kc_private.chat_members_remove_empty_chats() is
  'AFTER DELETE on chat_members (per statement): deletes chats left without members.';

create trigger chat_members_remove_empty_chats
  after delete on public.chat_members
  referencing old table as old_rows
  for each statement execute function kc_private.chat_members_remove_empty_chats();

-- True when the caller is a member of the chat and may currently use it. A block between
-- the two members of a direct chat closes it to both, in both directions, for as long as
-- the block exists (D105); lifting the block brings the thread back (FR-CHAT-009 AC2).
-- A support thread is never closed by a block (D33). Definer rights: the predicate reads
-- membership rows and block rows the caller cannot select directly.
create function kc_access.can_access_chat(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.chat_members cm
      join public.chats c on c.id = cm.chat_id
     where cm.chat_id = p_chat_id
       and cm.user_id = (select auth.uid())
       and not (c.kind = 'direct' and kc_access.is_blocked_between(c.direct_user_a, c.direct_user_b)));
$$;
comment on function kc_access.can_access_chat(uuid) is
  'Policy predicate: the caller is a member of the chat and no block closes it.';
grant execute on function kc_access.can_access_chat(uuid) to authenticated;

alter table public.chats enable row level security;
alter table public.chats force row level security;
alter table public.chat_members enable row level security;
alter table public.chat_members force row level security;

-- Members read their chats. Nothing is writable from a device: chats are opened, read and
-- hidden through the RPCs of 030_chat_rpcs.sql.
create policy chats_select_member on public.chats
  for select to authenticated
  using (kc_access.can_access_chat(id));

-- Members see who else is in the chat and how far each has read (read receipts,
-- FR-CHAT-002 AC4).
create policy chat_members_select_member on public.chat_members
  for select to authenticated
  using (kc_access.can_access_chat(chat_id));

grant select on public.chats to authenticated;
-- `hidden_at` is left out: whether a member removed the chat from their inbox is not shown
-- to the other member (FR-CHAT-016).
grant select (chat_id, user_id, role, last_read_at, joined_at) on public.chat_members to authenticated;
