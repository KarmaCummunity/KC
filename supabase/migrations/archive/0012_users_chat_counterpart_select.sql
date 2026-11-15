-- 0012_users_chat_counterpart_select | P0.5 — let chat participants see each other's basic profile.
-- FR-CHAT-001 / FR-CHAT-002 — the inbox row and conversation header MUST show the
-- counterpart's display_name + avatar. Without this policy, users with
-- privacy_mode='Private' or account_status='pending_verification' (the default
-- for newly-signed-up email users until they confirm) are hidden from each
-- other and the FE renders them as "משתמש שנמחק", which is wrong.
--
-- The new policy is additive: it lets viewer A read viewer B's row IFF a chat
-- row exists between them (regardless of privacy_mode / account_status). It
-- doesn't widen visibility for posts, follow lists, or any other surface — those
-- continue to honor users_select_public.

create policy users_select_chat_counterpart on public.users
  for select
  using (
    auth.uid() <> user_id
    and exists (
      select 1
      from public.chats c
      where (c.participant_a = auth.uid() and c.participant_b = users.user_id)
         or (c.participant_b = auth.uid() and c.participant_a = users.user_id)
    )
  );
