-- ─────────────────────────────────────────────
-- Migration 0072 — TD-67 / FR-MOD-010 / audit 2026-05-10 §15.6
-- Require `users.account_status = 'active'` for every client INSERT into
-- `posts`, `chats`, `messages`.
--
-- Before this migration, RLS INSERT policies on those tables only checked
-- `auth.uid()`. A user who got `suspended_for_false_reports` / `banned` /
-- `suspended_admin` server-side retained write capability through their
-- existing JWT until `useEnforceAccountGate` polled (60s) or the user re-
-- launched (TD-68, closed). Worst case: a 60-second write window after a
-- ban lands. This migration closes the gap at the RLS layer so writes are
-- denied even if the client somehow keeps a stale session.
--
-- Helper `public.is_active_member(uid)` is a `SECURITY DEFINER` predicate
-- so the policy can read `users.account_status` without needing a SELECT
-- grant on `users` for the calling role (the existing `users_select_active`
-- policy already does, but the helper isolates the check + makes it
-- reusable for future write-path policies).
--
-- Idempotent: `CREATE OR REPLACE FUNCTION` + `DROP POLICY IF EXISTS` +
-- `CREATE POLICY`. Safe to re-apply.
-- ─────────────────────────────────────────────

create or replace function public.is_active_member(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users where user_id = uid and account_status = 'active'
  );
$$;

revoke execute on function public.is_active_member(uuid) from public;
grant  execute on function public.is_active_member(uuid) to authenticated;

-- posts INSERT
drop policy if exists posts_insert_self on public.posts;
create policy posts_insert_self on public.posts
  for insert with check (
    auth.uid() = owner_id
    and public.is_active_member(auth.uid())
    and (
      visibility <> 'FollowersOnly'
      or exists (
        select 1 from public.users u
        where u.user_id = auth.uid() and u.privacy_mode = 'Private'
      )
    )
  );

-- chats INSERT
drop policy if exists chats_insert_self on public.chats;
create policy chats_insert_self on public.chats
  for insert
  with check (
    auth.uid() in (participant_a, participant_b)
    and public.is_active_member(auth.uid())
  );

-- messages INSERT (user-kind only; system messages still go through
-- SECURITY DEFINER server functions and are unaffected by this policy).
drop policy if exists messages_insert_user on public.messages;
create policy messages_insert_user on public.messages
  for insert
  with check (
    auth.uid() = sender_id
    and public.is_active_member(auth.uid())
    and kind = 'user'
    and system_payload is null
    and status = 'pending'
    and exists (
      select 1 from public.chats c
      where c.chat_id = messages.chat_id
        and auth.uid() in (c.participant_a, c.participant_b)
    )
  );
