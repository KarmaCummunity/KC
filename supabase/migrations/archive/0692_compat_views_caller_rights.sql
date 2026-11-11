-- 0692_compat_views_caller_rights | G1 compatibility views follow the base tables' access rules
--
-- `listings`, `giving_handoffs` and `ride_listings` became views over `posts`,
-- `post_handoffs` and `ride_post_details` in 0667 (ADR-006). This migration gives each view
-- the access rules of the tables it reads:
--
--   1. Reads use the caller's rights (`security_invoker`), so the row-level security of
--      `posts`, `post_handoffs` and `ride_post_details` decides which rows a client sees.
--   2. Clients write only `ride_listings` (the rides create and close flows); `listings` and
--      `giving_handoffs` are written by server functions, which own the views.
--   3. A client write to `ride_listings` passes `kc_private.ride_listings_view_guard` first:
--      the `posts_insert_self` rule (0072) on insert, the owner rule on update, and no
--      client move into or out of a moderation status (as `listings_view_update`, 0667).
--
-- Server code (service role, pg_cron, SECURITY DEFINER functions) keeps its access.

-- ── 1. Reads use the caller's rights ───────────────────────────────────────────
alter view public.listings set (security_invoker = true);
alter view public.giving_handoffs set (security_invoker = true);
alter view public.ride_listings set (security_invoker = true);

-- ── 2. Client privileges: read the listing views, write rides only ─────────────
revoke all on public.listings, public.giving_handoffs, public.ride_listings
  from public, anon, authenticated;
grant select on public.listings, public.ride_listings to anon, authenticated;
grant insert, update on public.ride_listings to authenticated;

-- ── 3. Owner guard on client writes to ride_listings ───────────────────────────
-- Runs before the INSTEAD OF trigger that does the write: Postgres fires row triggers of
-- the same kind in name order, so `trg_ride_listings_guard_*` precedes
-- `trg_ride_listings_view_*`. Raising stops the statement before any row is written.
create or replace function kc_private.ride_listings_view_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The signed-in caller; null for an anonymous request.
  v_caller uuid := auth.uid();
begin
  -- Only a client request is held to the rules below; server code writes as before.
  if coalesce(current_setting('role', true), '') not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- The `posts_insert_self` policy (0072) that the base table applies to a client.
    if v_caller is null
       or new.owner_id is distinct from v_caller
       or not public.is_active_member(v_caller) then
      raise exception 'ride_listing_owner_required' using errcode = '42501';
    end if;
    if new.visibility = 'FollowersOnly' and not exists (
      select 1 from public.users u where u.user_id = v_caller and u.privacy_mode = 'Private'
    ) then
      raise exception 'ride_listing_visibility_not_allowed' using errcode = '42501';
    end if;
    -- A new ride is published open; every other status is reached by a later move.
    if coalesce(new.status, 'open') <> 'open' then
      raise exception 'ride_listing_status_not_allowed' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE: only the owner edits a ride. The view's client statuses are `open`, `cancelled`
  -- (paused) and `closed` (delivered); moderation statuses belong to moderators.
  if v_caller is null or old.owner_id is distinct from v_caller then
    raise exception 'ride_listing_owner_required' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and (old.status in ('hidden_pending_review', 'removed_admin')
          or new.status is null
          or new.status not in ('open', 'cancelled', 'closed')) then
    raise exception 'ride_listing_status_not_allowed' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function kc_private.ride_listings_view_guard() from public, anon, authenticated;

drop trigger if exists trg_ride_listings_guard_insert on public.ride_listings;
create trigger trg_ride_listings_guard_insert
  instead of insert on public.ride_listings
  for each row execute function kc_private.ride_listings_view_guard();

drop trigger if exists trg_ride_listings_guard_update on public.ride_listings;
create trigger trg_ride_listings_guard_update
  instead of update on public.ride_listings
  for each row execute function kc_private.ride_listings_view_guard();
