-- 0545_list_my_blocked_users | FR-MOD-004 AC1 (user blocking in the launch scope, PM decision
-- 2026-11-03): the Blocked Users screen lists every member the caller has blocked, with avatar
-- and name, so the caller can unblock them.
-- The blocker cannot read a blocked member's users row (users_select_active filters a blocked
-- pair both ways, FR-MOD-009), so this SECURITY DEFINER read returns exactly the display fields
-- the list needs, for the caller's own blocks only (blocks.blocker_id = auth.uid()).

begin;

create or replace function public.list_my_blocked_users()
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
    join public.users u on u.user_id = b.blocked_id
   where b.blocker_id = auth.uid()
   order by b.created_at desc;
$$;

comment on function public.list_my_blocked_users() is
  'FR-MOD-004 AC1: the caller''s blocked members (id, display name, avatar, when), newest first.';

revoke all on function public.list_my_blocked_users() from public, anon;
grant execute on function public.list_my_blocked_users() to authenticated;

commit;
