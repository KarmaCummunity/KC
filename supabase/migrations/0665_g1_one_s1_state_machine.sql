-- 0665_g1_one_s1_state_machine | G1 step 6b (ADR-006, D-214, issue #1671):
-- 1. Drops the dangerous `posts.listing_id ON DELETE CASCADE` foreign key so listings cleanup cannot cascade to posts.
-- 2. Adds trigger on listings delete so mirror posts of listing-sourced listings still go, but post-owned posts are preserved.
-- 3. Drops legacy ride constraints on public.listings.
-- 4. Enforces the single S1 state machine on public.posts (spec 07 §7.1, D104) and owner lifecycle guards (active handoffs, expiry).

begin;

-- ── 1. posts.listing_id ON DELETE CASCADE fix ──────────────────────────────────────────────────
-- 0466 added listing_id with `references public.listings(listing_id) on delete cascade`.
-- Dropping this FK prevents deletions or drops on listings from destroying post records.
alter table public.posts drop constraint if exists posts_listing_id_fkey;

-- While listings still exist, deleting a listing-sourced listing deletes its mirror post,
-- but a post-owned listing does NOT cascade to its post.
create or replace function public.listings_delete_mirror_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.posts
   where listing_id = old.listing_id
     and (old.legacy_post_id is null or post_id is distinct from old.legacy_post_id);
  return old;
end;
$$;

comment on function public.listings_delete_mirror_post() is
  'G1 step 6b (0665): cleans up mirror posts when a listing-sourced listing is deleted, without cascading to post-owned posts.';

revoke all on function public.listings_delete_mirror_post() from public, anon, authenticated;
grant execute on function public.listings_delete_mirror_post() to service_role;

drop trigger if exists listings_delete_mirror on public.listings;
create trigger listings_delete_mirror
  after delete on public.listings
  for each row execute function public.listings_delete_mirror_post();

-- ── 2. Legacy ride foreign keys on listings ──────────────────────────────────────────────────────
alter table public.listings drop constraint if exists listings_legacy_ride_id_fkey;
alter table public.listings drop constraint if exists listings_legacy_origin_ride;

-- ── 3. Single S1 state machine on public.posts ──────────────────────────────────────────────────
create or replace function public.posts_enforce_status_fsm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from text := old.status;
  v_to   text := new.status;
  v_valid boolean := false;
begin
  if v_from is not distinct from v_to then
    return new;
  end if;

  case v_from
    when 'open' then
      v_valid := v_to in ('paused', 'closed_delivered', 'deleted_no_recipient', 'expired', 'removed_admin', 'hidden_pending_review');
    when 'paused' then
      v_valid := v_to in ('open', 'deleted_no_recipient', 'expired', 'removed_admin', 'hidden_pending_review');
    when 'closed_delivered' then
      v_valid := v_to in ('open', 'deleted_no_recipient', 'removed_admin', 'hidden_pending_review');
    when 'expired' then
      v_valid := v_to in ('open', 'deleted_no_recipient', 'removed_admin', 'hidden_pending_review');
    when 'hidden_pending_review' then
      v_valid := v_to in ('open', 'closed_delivered', 'deleted_no_recipient', 'removed_admin');
    when 'deleted_no_recipient' then
      v_valid := v_to in ('open', 'removed_admin');
    when 'removed_admin' then
      v_valid := v_to in ('open');
    else
      v_valid := false;
  end case;

  if not v_valid then
    raise exception 'posts_status_transition_invalid'
      using errcode = '23514',
            detail = format('invalid status transition from %s to %s', v_from, v_to);
  end if;

  -- Owner guards per Spec 07 §7.1 and D104:
  -- 1. Resuming an expired post is forbidden
  if v_from = 'paused' and v_to = 'open' then
    if new.expires_at is not null and new.expires_at <= now() then
      raise exception 'listing_expired'
        using errcode = '23514',
              detail = 'cannot resume an expired post';
    end if;
  end if;

  -- 2. Pausing with an active reservation/booking is forbidden
  if v_to = 'paused' then
    if exists (
      select 1 from public.post_handoffs h
       where h.post_id = new.post_id
         and h.world_slug <> 'time'
         and h.status in ('reserved', 'confirmed')
    ) then
      raise exception 'listing_has_active_handoff'
        using errcode = '23514',
              detail = 'cannot pause a post with an active handoff';
    end if;
  end if;

  -- 3. Deleting with an active reservation/booking is forbidden
  if v_to = 'deleted_no_recipient' and v_from in ('open', 'paused') then
    if exists (
      select 1 from public.post_handoffs h
       where h.post_id = new.post_id
         and h.world_slug <> 'time'
         and h.status in ('reserved', 'confirmed')
    ) then
      raise exception 'listing_has_active_handoff'
        using errcode = '23514',
              detail = 'cannot delete a post with an active handoff';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.posts_enforce_status_fsm() is
  'G1 step 6b (0665): enforces the single S1 state machine on posts.status (spec 07 §7.1, D104) and owner lifecycle guards (active handoffs, expiry).';

revoke all on function public.posts_enforce_status_fsm() from public, anon, authenticated;
grant execute on function public.posts_enforce_status_fsm() to service_role;

drop trigger if exists posts_status_fsm on public.posts;
create trigger posts_status_fsm
  before update of status on public.posts
  for each row
  execute function public.posts_enforce_status_fsm();

commit;
