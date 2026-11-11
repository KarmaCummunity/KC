-- Social graph · blocks
--
-- A block hides two members from each other in both directions. Only the blocker can see or
-- remove the row: the blocked member is never told who blocked them.

create table public.blocks (
  blocker_id uuid not null references public.users (id) on delete cascade,
  blocked_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self_chk check (blocker_id <> blocked_id)
);
comment on table public.blocks is 'Blocks between members. Visible to the blocker only; effective in both directions.';

-- Reverse lookup: "has this member blocked me?" in the bilateral predicate below.
create index blocks_blocked_idx on public.blocks (blocked_id, blocker_id);

-- True when either member has blocked the other. Definer rights are required because a
-- member cannot read the other side's block row. Used by policies on every table that must
-- hide blocked counterparts.
create function kc_access.is_blocked_between(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.blocks b
     where (b.blocker_id = p_user_a and b.blocked_id = p_user_b)
        or (b.blocker_id = p_user_b and b.blocked_id = p_user_a));
$$;
comment on function kc_access.is_blocked_between(uuid, uuid) is
  'Policy predicate: a block exists between the two members, in either direction.';
grant execute on function kc_access.is_blocked_between(uuid, uuid) to authenticated;

-- Blocking ends any follow relation between the two members, in both directions.
create function kc_private.blocks_remove_follows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.follows f
   where (f.follower_id = new.blocker_id and f.followed_id = new.blocked_id)
      or (f.follower_id = new.blocked_id and f.followed_id = new.blocker_id);
  return null;
end;
$$;

create trigger blocks_remove_follows
  after insert on public.blocks
  for each row execute function kc_private.blocks_remove_follows();

alter table public.blocks enable row level security;
alter table public.blocks force row level security;

create policy blocks_select_own on public.blocks
  for select to authenticated
  using (blocker_id = (select auth.uid()));

create policy blocks_insert_own on public.blocks
  for insert to authenticated
  with check (blocker_id = (select auth.uid()));

create policy blocks_delete_own on public.blocks
  for delete to authenticated
  using (blocker_id = (select auth.uid()));

grant select, insert, delete on public.blocks to authenticated;

-- Blocked counterparts disappear from each other. Restrictive, so it narrows whatever the
-- permissive profile policies allow; a member's own row is never affected (no self-block).
create policy users_hide_blocked on public.users
  as restrictive
  for select to authenticated
  using (not kc_access.is_blocked_between((select auth.uid()), id));
