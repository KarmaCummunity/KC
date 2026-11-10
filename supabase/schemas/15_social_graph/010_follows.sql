-- Social graph · follows
--
-- One row per "follower follows followed". A private profile is followed through an approved
-- request, so an edge is created only by server code; removing an edge (unfollow, or removing
-- a follower) is a plain delete by either party (FR-FOLLOW-002, FR-FOLLOW-009).

create table public.follows (
  follower_id uuid not null references public.users (id) on delete cascade,
  followed_id uuid not null references public.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followed_id),
  constraint follows_not_self_chk check (follower_id <> followed_id)
);
comment on table public.follows is 'Follow edges. Created by server code, deleted by either party.';

-- Followers list of a profile, newest first (keyset on created_at, follower_id).
create index follows_followed_recent_idx on public.follows (followed_id, created_at desc, follower_id);
-- Following list of a profile, newest first; also serves the feed's "people I follow" lookup.
create index follows_follower_recent_idx on public.follows (follower_id, created_at desc, followed_id);

-- Keeps the two profile counters in step with the edge, in the same transaction
-- (FR-FOLLOW-001 AC2). Runs with definer rights because counters are not client-writable.
create function kc_private.follows_sync_counters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta constant integer := case tg_op when 'INSERT' then 1 else -1 end;
  v_edge constant public.follows := case tg_op when 'INSERT' then new else old end;
begin
  update public.user_stats s
     set followers_count = greatest(s.followers_count + v_delta, 0)
   where s.user_id = v_edge.followed_id;
  update public.user_stats s
     set following_count = greatest(s.following_count + v_delta, 0)
   where s.user_id = v_edge.follower_id;
  return null;
end;
$$;

create trigger follows_sync_counters
  after insert or delete on public.follows
  for each row execute function kc_private.follows_sync_counters();

alter table public.follows enable row level security;
alter table public.follows force row level security;

-- Followers and following lists of any member are visible to every signed-in member,
-- whatever the privacy mode (FR-PROFILE-010 AC1). A profile hidden from the viewer drops out
-- when the list is joined to `users`.
create policy follows_select_member on public.follows
  for select to authenticated
  using (true);

-- Unfollow, or remove one of my followers.
create policy follows_delete_party on public.follows
  for delete to authenticated
  using ((select auth.uid()) in (follower_id, followed_id));

grant select, delete on public.follows to authenticated;
