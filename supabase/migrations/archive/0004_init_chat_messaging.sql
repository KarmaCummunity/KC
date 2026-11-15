-- 0004_init_chat_messaging | P0.2.d — Chat & Messaging
-- FR-CHAT-001..007+009+011+012+013, FR-MOD-009
--
-- Why directional `has_blocked` and not bilateral `is_blocked` for chats:
--   FR-CHAT-009 AC1 carves chats out of the bilateral block rule (FR-MOD-009).
--   When A blocks B: A's Inbox hides the chat; B's view still shows it. B's
--   sent messages persist (status=pending) but are never seen by A because
--   `is_chat_visible_to(chat, A)` returns false — so the messages SELECT policy
--   filters them out for A. This is precisely "succeed-locally and remain
--   undelivered" (FR-CHAT-009 AC3).

-- ── 1. chats ─────────────────────────────────────────────────────────────────
-- One row per ordered pair (a < b). The canonicalize trigger below swaps inputs
-- if the caller passes them out of order — clients can ignore the convention.
create table if not exists public.chats (
  chat_id            uuid primary key default gen_random_uuid(),
  participant_a      uuid not null references public.users(user_id) on delete cascade,
  participant_b      uuid not null references public.users(user_id) on delete cascade,
  anchor_post_id     uuid references public.posts(post_id) on delete set null,
  is_support_thread  boolean not null default false,
  last_message_at    timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  -- Canonical ordering enforces uniqueness on the unordered pair without
  -- needing two unique indexes or LEAST/GREATEST in queries.
  constraint chats_canonical_order check (participant_a < participant_b),
  constraint chats_distinct_participants check (participant_a <> participant_b),
  unique (participant_a, participant_b)
);

-- Inbox: "my chats sorted by recency" — index covers both halves of the pair.
create index chats_participant_a_recent_idx on public.chats (participant_a, last_message_at desc);
create index chats_participant_b_recent_idx on public.chats (participant_b, last_message_at desc);

-- Anchor lookup (analytics-side; used for chat_first_message attribution).
create index chats_anchor_post_idx on public.chats (anchor_post_id) where anchor_post_id is not null;

-- ── 2. messages ──────────────────────────────────────────────────────────────
-- `sender_id` ON DELETE SET NULL preserves the message body in the thread when
-- the sending user is hard-deleted (FR-CHAT-013 AC1: counterpart sees the
-- placeholder; the body remains).
create table if not exists public.messages (
  message_id     uuid primary key default gen_random_uuid(),
  chat_id        uuid not null references public.chats(chat_id) on delete cascade,
  sender_id      uuid references public.users(user_id) on delete set null,
  kind           text not null default 'user'
    check (kind in ('user','system')),
  body           text
    check (body is null or char_length(body) between 1 and 2000),
  system_payload jsonb,
  status         text not null default 'pending'
    check (status in ('pending','delivered','read')),
  created_at     timestamptz not null default now(),
  delivered_at   timestamptz,
  read_at        timestamptz,
  -- Shape invariants: user messages have a body and no payload; system messages
  -- have a payload and (optionally) a body. Sender_id is required for user
  -- messages (anonymized to NULL only by the cascade on User delete).
  constraint messages_user_shape check (
    kind <> 'user' or (body is not null and system_payload is null)
  ),
  constraint messages_system_shape check (
    kind <> 'system' or (system_payload is not null)
  ),
  -- Status timestamps must be monotonic.
  constraint messages_timestamps_monotonic check (
    (delivered_at is null or delivered_at >= created_at)
    and (read_at is null or (delivered_at is not null and read_at >= delivered_at))
  )
);

-- Hot-path: render thread (newest first) and unread-badge count.
create index messages_chat_recent_idx on public.messages (chat_id, created_at desc);
create index messages_chat_unread_idx on public.messages (chat_id) where status <> 'read';
create index messages_sender_idx on public.messages (sender_id, created_at desc) where sender_id is not null;

-- ── 3. has_blocked() — directional predicate for chat visibility ─────────────
-- Distinct from `is_blocked` (bilateral). Required by FR-CHAT-009 carve-out of
-- the block rule for chats specifically (the blocked party still sees the
-- thread; only the blocker's view is filtered).
-- SECURITY DEFINER for the same reason as `is_blocked` — RLS would otherwise
-- only expose the viewer's own outgoing block rows, but here the answer is
-- conceptually authoritative regardless of who's asking.
create or replace function public.has_blocked(blocker uuid, blocked uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when blocker is null or blocked is null or blocker = blocked then false
    else exists (
      select 1 from public.blocks
      where blocker_id = blocker and blocked_id = blocked
    )
  end;
$$;

-- ── 4. is_chat_visible_to() — viewer-perspective predicate ──────────────────
-- Encodes the FR-CHAT-009 split:
--   - Viewer must be a participant.
--   - If viewer has blocked the counterpart → invisible (FR-CHAT-009 AC1
--     blocker-side behaviour).
--   - If counterpart has blocked viewer → still visible (FR-CHAT-009 AC1
--     blocked-side behaviour).
create or replace function public.is_chat_visible_to(p_chat public.chats, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_viewer is null then false
    when p_viewer not in (p_chat.participant_a, p_chat.participant_b) then false
    when public.has_blocked(
      p_viewer,
      case
        when p_viewer = p_chat.participant_a then p_chat.participant_b
        else p_chat.participant_a
      end
    ) then false
    else true
  end;
$$;

-- ── 5. Canonicalize chat participants on INSERT ──────────────────────────────
-- Lets clients pass (a, b) in any order; the trigger sorts before the unique
-- constraint and RLS WITH CHECK fire. PostgreSQL evaluation order is BEFORE
-- triggers → constraints → RLS WITH CHECK → store, so the policy below sees
-- the canonical row.
create or replace function public.chats_canonicalize_participants()
returns trigger
language plpgsql
as $$
declare
  tmp uuid;
begin
  if new.participant_a is null or new.participant_b is null then
    raise exception 'chat_participants_required'
      using errcode = 'check_violation';
  end if;
  if new.participant_a = new.participant_b then
    raise exception 'chat_participants_must_differ'
      using errcode = 'check_violation';
  end if;
  if new.participant_a > new.participant_b then
    tmp := new.participant_a;
    new.participant_a := new.participant_b;
    new.participant_b := tmp;
  end if;
  return new;
end;
$$;

create trigger chats_before_insert_canonicalize
  before insert on public.chats
  for each row execute function public.chats_canonicalize_participants();

-- ── 6. Auto-flag support thread ──────────────────────────────────────────────
-- FR-CHAT-007 AC2: support thread carries `is_support_thread = true`. Set this
-- automatically when either participant has `is_super_admin = true`. Runs as
-- DEFINER because the inserter may not have RLS access to read `is_super_admin`
-- on the counterpart (e.g. the user creating their own support thread cannot
-- SELECT the admin row through normal RLS).
create or replace function public.chats_set_support_thread_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.users
    where user_id in (new.participant_a, new.participant_b)
      and is_super_admin = true
  ) then
    new.is_support_thread := true;
  end if;
  return new;
end;
$$;

create trigger chats_before_insert_support_flag
  before insert on public.chats
  for each row execute function public.chats_set_support_thread_flag();

-- ── 7. Bump chat last_message_at on every new message ────────────────────────
-- AFTER INSERT trigger; SECURITY DEFINER bypasses the chats UPDATE policy
-- (clients have no direct UPDATE grant on chats).
create or replace function public.chats_bump_last_message_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chats
  set last_message_at = new.created_at
  where chat_id = new.chat_id;
  return new;
end;
$$;

create trigger messages_after_insert_bump_chat
  after insert on public.messages
  for each row execute function public.chats_bump_last_message_at();

-- ── 8. Message status timestamps ─────────────────────────────────────────────
-- Stamps `delivered_at` / `read_at` automatically as `status` advances.
-- Allowed transitions: pending → delivered, pending → read, delivered → read.
-- Anything else (read → delivered, delivered → pending, etc.) errors.
create or replace function public.messages_on_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if old.status = 'pending' and new.status = 'delivered' then
    if new.delivered_at is null then
      new.delivered_at := now();
    end if;
  elsif old.status = 'pending' and new.status = 'read' then
    if new.delivered_at is null then new.delivered_at := now(); end if;
    if new.read_at is null then new.read_at := now(); end if;
  elsif old.status = 'delivered' and new.status = 'read' then
    if new.read_at is null then new.read_at := now(); end if;
  else
    raise exception 'invalid_message_status_transition'
      using errcode = 'check_violation',
            detail  = 'from=' || old.status || ' to=' || new.status;
  end if;
  return new;
end;
$$;

create trigger messages_before_update_status
  before update of status on public.messages
  for each row execute function public.messages_on_status_change();

-- ── 9. RLS — chats ───────────────────────────────────────────────────────────
alter table public.chats enable row level security;

-- SELECT: visible per is_chat_visible_to (participant + not blocker-side).
create policy chats_select_visible on public.chats
  for select
  using (public.is_chat_visible_to(chats.*, auth.uid()));

-- INSERT: caller must be one of the two participants. The canonicalize trigger
-- already ran by this point (see §5) so participant_a/b are sorted; the rule
-- "auth.uid() in (a, b)" is order-independent anyway.
create policy chats_insert_self on public.chats
  for insert
  with check (auth.uid() in (participant_a, participant_b));

-- No client UPDATE / DELETE policies. last_message_at is server-managed (§7);
-- chat lifecycle (archive) is post-MVP.

-- ── 10. RLS — messages ───────────────────────────────────────────────────────
alter table public.messages enable row level security;

-- SELECT: visible iff the chat is visible to me.
create policy messages_select_visible on public.messages
  for select
  using (
    exists (
      select 1 from public.chats c
      where c.chat_id = messages.chat_id
        and public.is_chat_visible_to(c.*, auth.uid())
    )
  );

-- INSERT: only as a user-kind message, only as myself, only into a chat I'm
-- part of. The chat must EXIST (FK guards that), but the EXISTS subquery here
-- intentionally does NOT delegate to RLS visibility — the blocked party can
-- still insert into a chat they participate in even though the blocker has
-- hidden it (FR-CHAT-009 AC3 "succeed-locally"). We bypass via direct
-- participant check rather than relying on chats SELECT visibility.
--
-- System messages (kind='system') are reserved for SECURITY DEFINER server
-- functions added in P0.2.e (moderation) and FR-MOD-002 (report-issue inject).
create policy messages_insert_user on public.messages
  for insert
  with check (
    auth.uid() = sender_id
    and kind = 'user'
    and system_payload is null
    and status = 'pending'
    and exists (
      select 1 from public.chats c
      where c.chat_id = messages.chat_id
        and auth.uid() in (c.participant_a, c.participant_b)
    )
  );

-- UPDATE: only the recipient (i.e. NOT the sender) advances status. Sender
-- never re-writes their own message. System messages don't transition.
-- The BEFORE UPDATE trigger (§8) enforces valid transitions.
create policy messages_update_status_recipient on public.messages
  for update
  using (
    sender_id is not null
    and auth.uid() <> sender_id
    and kind = 'user'
    and exists (
      select 1 from public.chats c
      where c.chat_id = messages.chat_id
        and auth.uid() in (c.participant_a, c.participant_b)
    )
  )
  with check (
    sender_id is not null
    and auth.uid() <> sender_id
    and status in ('delivered','read')
  );

-- No DELETE policy — messages are immutable once sent. Account deletion
-- handles anonymisation via the sender_id cascade (FR-CHAT-013 AC1).

-- ── 11. Realtime publication ────────────────────────────────────────────────
-- Supabase Realtime subscribes via the `supabase_realtime` publication. RLS is
-- still applied on the broadcast side, so a client only receives events for
-- rows the policies above let them SELECT. Wrapped in a guard so the migration
-- is safe to apply locally where the publication may not exist.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
    ) then
      execute 'alter publication supabase_realtime add table public.messages';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chats'
    ) then
      execute 'alter publication supabase_realtime add table public.chats';
    end if;
  end if;
end $$;

-- ── 12. Grants ──────────────────────────────────────────────────────────────
-- chats: no UPDATE/DELETE — last_message_at flows through SECURITY DEFINER.
grant select         on public.chats    to authenticated;
grant insert         on public.chats    to authenticated;

-- messages: column-level UPDATE so the recipient can flip status only.
-- delivered_at / read_at are server-stamped by the BEFORE UPDATE trigger.
grant select          on public.messages to authenticated;
grant insert          on public.messages to authenticated;
grant update (status) on public.messages to authenticated;
