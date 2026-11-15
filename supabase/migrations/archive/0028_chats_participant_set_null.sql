-- 0028_chats_participant_set_null | P2.2 — FR-SETTINGS-012 V1 prep
-- Make chats survive participant deletion by changing the FK action to
-- SET NULL, allow NULL columns, and rewrite every RLS predicate that
-- compares against (participant_a, participant_b) to be NULL-safe.
-- Without these RLS rewrites, the surviving participant loses access
-- to the chat once the other side is deleted (NULL poisons IN/NOT IN).

set search_path = public;

-- ── 1. Relax columns + change cascade action ────────────────────────────────
alter table public.chats alter column participant_a drop not null;
alter table public.chats alter column participant_b drop not null;

alter table public.chats drop constraint if exists chats_participant_a_fkey;
alter table public.chats drop constraint if exists chats_participant_b_fkey;
alter table public.chats
  add constraint chats_participant_a_fkey
  foreign key (participant_a) references public.users(user_id) on delete set null;
alter table public.chats
  add constraint chats_participant_b_fkey
  foreign key (participant_b) references public.users(user_id) on delete set null;

-- ── 2. CHECK: at least one side alive (no orphan rows) ──────────────────────
alter table public.chats
  add constraint chats_at_least_one_participant
  check (participant_a is not null or participant_b is not null);

-- ── 3. Update chats_canonical_order to be NULL-safe ─────────────────────────
alter table public.chats drop constraint if exists chats_canonical_order;
alter table public.chats
  add constraint chats_canonical_order
  check (participant_a is null or participant_b is null or participant_a < participant_b);

-- ── 4. NULL-safe rewrite of is_chat_visible_to (replaces 0005 version) ──────
create or replace function public.is_chat_visible_to(p_chat public.chats, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_viewer is null then false
    when p_viewer is distinct from p_chat.participant_a
     and p_viewer is distinct from p_chat.participant_b then false
    when p_chat.removed_at is not null then false
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

-- ── 5. NULL-safe rewrite of messages_insert_user policy ─────────────────────
-- 0004:284 uses `auth.uid() in (c.participant_a, c.participant_b)` which is
-- NULL-poisoned. Rewrite via OR of equalities (NULL = uuid yields NULL,
-- the OR can still be TRUE on the live side).
drop policy if exists messages_insert_user on public.messages;
create policy messages_insert_user on public.messages
  for insert
  to authenticated
  with check (
    kind = 'user'
    and exists (
      select 1 from public.chats c
      where c.chat_id = messages.chat_id
        and c.removed_at is null
        and (auth.uid() = c.participant_a or auth.uid() = c.participant_b)
    )
    and sender_id = auth.uid()
  );

-- ── 6. NULL-safe rewrite of messages_update_status_recipient policy ─────────
drop policy if exists messages_update_status_recipient on public.messages;
create policy messages_update_status_recipient on public.messages
  for update
  to authenticated
  using (
    exists (
      select 1 from public.chats c
      where c.chat_id = messages.chat_id
        and (auth.uid() = c.participant_a or auth.uid() = c.participant_b)
    )
  )
  with check (
    exists (
      select 1 from public.chats c
      where c.chat_id = messages.chat_id
        and (auth.uid() = c.participant_a or auth.uid() = c.participant_b)
    )
  );

-- ── 7. NULL-safe rewrite of chats_insert_self policy ────────────────────────
drop policy if exists chats_insert_self on public.chats;
create policy chats_insert_self on public.chats
  for insert
  to authenticated
  with check (
    auth.uid() = participant_a or auth.uid() = participant_b
  );

-- ── 8. chats_select_visible already delegates to is_chat_visible_to (0004:247);
--      the function rewrite at step 4 makes it NULL-safe automatically. No-op.
--      Same for messages_select_visible (0004:265). No-op.

-- Migration is non-destructive: existing chat rows keep both participants
-- non-null until an account deletion sets one to NULL.
