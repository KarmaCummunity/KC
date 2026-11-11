-- 0031_users_select_chat_counterpart_active_gate | FR-CHAT-001 / FR-SETTINGS-012
-- Tighten users_select_chat_counterpart: only expose counterpart rows that are
-- still eligible for normal app use (active or pending email verification).
-- Excludes suspended, banned, and soft-deleted statuses so RLS cannot leak a
-- "full profile" read path when the row should not be treated as a live user.

set search_path = public;

drop policy if exists users_select_chat_counterpart on public.users;

create policy users_select_chat_counterpart on public.users
  for select
  using (
    auth.uid() is not null
    and auth.uid() <> user_id
    and account_status in ('active', 'pending_verification')
    and exists (
      select 1
      from public.chats c
      where (c.participant_a = auth.uid() and c.participant_b = users.user_id)
         or (c.participant_b = auth.uid() and c.participant_a = users.user_id)
    )
  );
