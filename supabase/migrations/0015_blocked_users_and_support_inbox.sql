-- Moderation · the blocked users list and the staff support inbox (FR-MOD-004, FR-MOD-002,
-- FR-CHAT-007, FR-ADMIN-013 AC2; D105)
--
-- 1. A member lists the members they blocked. The blocked member's profile row is hidden from
--    the blocker in both directions (users_hide_blocked), so the list is read with definer
--    rights, from the caller's own block rows only. It is the only way back to a blocked
--    member, and Apple review requires it (D105).
-- 2. A member files a support issue: the issue becomes a `support_issue` system message in
--    their support thread, with a stable id, the category and the description verbatim, and
--    the server refuses a description outside 10..500 characters (FR-MOD-002 AC1–AC3, AC6).
--    Support staff are told a new issue arrived.
-- 3. Platform staff (support and above) read every support thread, list them newest first and
--    join one as its `support_agent` member, after which they answer it like any chat. Before
--    the baseline, the super admin was the other member of every support thread; now the
--    thread belongs to the member and staff join it.

-- ── 1. Blocked users (FR-MOD-004 AC1) ──────────────────────────────────────────────────────

-- The blocker's list, newest block first; also the keyset of list_my_blocked_users.
create index blocks_blocker_recent_idx on public.blocks (blocker_id, created_at desc, blocked_id desc);

-- One keyset page of the caller's blocks with the blocked member's display fields. The cursor
-- is the block time and member id of the last row of the previous page. A purged member's row
-- is gone with their block (on delete cascade), so every row has a profile.
create function public.list_my_blocked_users(
  p_before_blocked_at timestamptz default null,
  p_before_user_id uuid default null,
  p_limit integer default 50
)
returns table (
  user_id      uuid,
  display_name text,
  avatar_url   text,
  blocked_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select b.blocked_id, u.display_name, u.avatar_url, b.created_at
    from public.blocks b
    join public.users u on u.id = b.blocked_id
   where b.blocker_id = (select auth.uid())
     and (p_before_blocked_at is null
          or (b.created_at, b.blocked_id)
             < (p_before_blocked_at, coalesce(p_before_user_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by b.created_at desc, b.blocked_id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;
comment on function public.list_my_blocked_users(timestamptz, uuid, integer) is
  'FR-MOD-004 AC1: the caller''s blocked members (id, display name, avatar, when), newest first, keyset paged.';
grant execute on function public.list_my_blocked_users(timestamptz, uuid, integer) to authenticated;

-- ── 2. Support issues (FR-MOD-002) ─────────────────────────────────────────────────────────

-- Files a support issue as the caller and returns their support thread (AC4 opens it). The
-- issue is one system message: { kind: 'support_issue', issue_id, category, description }.
-- `p_issue_id` is the id the app gave the issue; sending the same id again returns the thread
-- without a second message, so a retry after a lost answer files one issue (AC7). Open to a
-- member whose account is not active, as the support thread is (D33). No report row and no
-- threshold counter (AC5). Errors (P0001): description_too_short, description_too_long,
-- invalid_support_category, rate_limited; unauthenticated (42501).
create function public.submit_support_issue(
  p_category text,
  p_description text,
  p_issue_id uuid default null
)
returns public.chats
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
  v_description constant text := btrim(coalesce(p_description, ''));
  v_category constant text := nullif(btrim(coalesce(p_category, '')), '');
  v_issue_id constant uuid := coalesce(p_issue_id, gen_random_uuid());
  v_chat public.chats;
begin
  if char_length(v_description) < 10 then
    raise exception 'description_too_short' using errcode = 'P0001';
  end if;
  if char_length(v_description) > 500 then
    raise exception 'description_too_long' using errcode = 'P0001';
  end if;
  if v_category is not null and v_category not in ('Bug', 'Account', 'Suggestion', 'Other') then
    raise exception 'invalid_support_category' using errcode = 'P0001';
  end if;

  v_chat := public.open_support_thread();
  if exists (select 1 from public.messages m
              where m.chat_id = v_chat.id and m.kind = 'system'
                and m.system_payload ->> 'kind' = 'support_issue'
                and m.system_payload ->> 'issue_id' = v_issue_id::text) then
    return v_chat;
  end if;
  perform kc_private.rate_limit_enforce('message_send', v_user_id);  -- 95_platform

  perform kc_private.chat_post_system_message(v_chat.id, jsonb_build_object(
    'kind', 'support_issue', 'issue_id', v_issue_id,
    'category', v_category, 'description', v_description));
  perform kc_private.notify_support_staff('support_issue_received', v_chat.id, v_issue_id);
  select c.* into v_chat from public.chats c where c.id = v_chat.id;
  return v_chat;
end;
$$;
comment on function public.submit_support_issue(text, text, uuid) is
  'FR-MOD-002: files a support issue as a system message in the caller''s support thread; idempotent on p_issue_id.';
grant execute on function public.submit_support_issue(text, text, uuid) to authenticated;

-- Sends one notification event to every active platform staff member (support and above),
-- once per issue.
create function kc_private.notify_support_staff(p_kind text, p_chat_id uuid, p_issue_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select kc_private.outbox_enqueue('notification', jsonb_build_object(
           'kind', p_kind, 'recipient_id', staff.user_id, 'actor_id', null,
           'entity', jsonb_build_object('type', 'chat', 'id', p_chat_id),
           'data', jsonb_build_object('dedupe_key', p_kind || ':' || p_issue_id || ':' || staff.user_id)))
    from (select distinct g.user_id
            from public.admin_role_grants g
            join kc_private.admin_roles r on r.role = g.role and r.is_platform
            join kc_private.admin_roles s on s.role = 'support'
           where g.revoked_at is null and r.rank >= s.rank) staff;
$$;
comment on function kc_private.notify_support_staff(text, uuid, uuid) is
  'Enqueues a notification about a support thread for each member of the platform staff.';

insert into kc_private.notification_kinds (kind, category, title_key, body_key) values
  ('support_issue_received', 'critical', 'notifications.supportIssueReceivedTitle', 'notifications.supportIssueReceivedBody');

-- ── 3. Staff and support threads (FR-CHAT-007, FR-ADMIN-013 AC2) ────────────────────────────

-- Staff inbox of support threads: newest activity first; also its keyset.
create index chats_support_recent_idx on public.chats (last_message_at desc, id desc)
  where kind = 'support' and last_message_at is not null;

-- Platform staff read every support thread, its members and its messages without joining it.
-- Writing still needs membership (send_message), which admin_join_support_thread grants.
create policy chats_select_staff_support on public.chats
  for select to authenticated
  using (kind = 'support' and (select kc_access.is_admin()));
create policy chat_members_select_staff_support on public.chat_members
  for select to authenticated
  using ((select kc_access.is_admin())
         and exists (select 1 from public.chats c where c.id = chat_members.chat_id and c.kind = 'support'));
create policy messages_select_staff_support on public.messages
  for select to authenticated
  using ((select kc_access.is_admin())
         and exists (select 1 from public.chats c where c.id = messages.chat_id and c.kind = 'support'));

-- One keyset page of the support threads that have at least one message, newest activity
-- first, with the member the thread belongs to and whether the caller has joined it.
-- Platform staff only. Errors: unauthenticated / forbidden (42501).
create function public.admin_list_support_threads(
  p_before_last_message_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 30
)
returns table (
  chat_id             uuid,
  member_id           uuid,
  member_display_name text,
  member_avatar_url   text,
  last_message_at     timestamptz,
  created_at          timestamptz,
  joined              boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('support');
begin
  return query
  select c.id, c.support_user_id, u.display_name, u.avatar_url, c.last_message_at, c.created_at,
         exists (select 1 from public.chat_members cm where cm.chat_id = c.id and cm.user_id = v_actor)
    from public.chats c
    left join public.users u on u.id = c.support_user_id
   where c.kind = 'support' and c.last_message_at is not null
     and (p_before_last_message_at is null
          or (c.last_message_at, c.id)
             < (p_before_last_message_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by c.last_message_at desc, c.id desc
   limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;
comment on function public.admin_list_support_threads(timestamptz, uuid, integer) is
  'Staff: support threads with messages, newest activity first, keyset paged.';
grant execute on function public.admin_list_support_threads(timestamptz, uuid, integer) to authenticated;

-- Adds the caller to a support thread as its `support_agent` and returns the thread; the
-- thread then sits in the caller's inbox and they answer it with send_message. Idempotent: a
-- second join changes nothing and writes no second audit row. Platform staff only.
-- Errors: forbidden (42501); P0001 — chat_not_found (no such support thread).
create function public.admin_join_support_thread(p_chat_id uuid)
returns public.chats
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('support');
  v_chat public.chats;
begin
  select c.* into v_chat from public.chats c where c.id = p_chat_id and c.kind = 'support';
  if not found then
    raise exception 'chat_not_found' using errcode = 'P0001';
  end if;
  if v_chat.support_user_id = v_actor then
    return v_chat;  -- the staff member's own thread: already its member
  end if;
  insert into public.chat_members (chat_id, user_id, role)
  values (p_chat_id, v_actor, 'support_agent')
  on conflict do nothing;
  if found then
    perform kc_private.audit_record('join_support_thread', 'chat', p_chat_id,
                                    jsonb_build_object('member_id', v_chat.support_user_id), v_actor);
  end if;
  return v_chat;
end;
$$;
comment on function public.admin_join_support_thread(uuid) is
  'Staff: joins a support thread as its support agent; idempotent and audited.';
grant execute on function public.admin_join_support_thread(uuid) to authenticated;

-- Opens a member's support thread from a staff screen (a report case): the member's thread,
-- created if they never opened one, joined by the caller. Platform staff only.
-- Errors: forbidden (42501); P0001 — user_unavailable (no such member).
create function public.admin_open_member_support_thread(p_user_id uuid)
returns public.chats
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chat public.chats;
begin
  perform kc_private.require_admin_role('support');
  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception 'user_unavailable' using errcode = 'P0001';
  end if;
  insert into public.chats as c (kind, support_user_id)
  values ('support', p_user_id)
  on conflict (support_user_id) where kind = 'support'
  do update set support_user_id = excluded.support_user_id
  returning c.* into v_chat;
  insert into public.chat_members (chat_id, user_id)
  values (v_chat.id, p_user_id)
  on conflict do nothing;
  return public.admin_join_support_thread(v_chat.id);
end;
$$;
comment on function public.admin_open_member_support_thread(uuid) is
  'Staff: a member''s support thread, created if needed, joined by the caller.';
grant execute on function public.admin_open_member_support_thread(uuid) to authenticated;
