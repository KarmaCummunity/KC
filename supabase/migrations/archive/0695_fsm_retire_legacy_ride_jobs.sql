-- 0695_fsm_retire_legacy_ride_jobs | Wave 1d of the FSM kernel program (#1989, G61)
--
-- Background jobs written for the legacy ride tables kept running after `ride_listings`
-- became a view over `posts` (0667, ADR-006). Each now moves posts outside the post graph's
-- rules, or does nothing (docs/architecture/state-machines.md §4, background jobs):
--
--   * `ride_listings_expire_check` (0135, every 15 min) expired every open ride post 3 hours
--     after departure, requests included. D21 (spec §7.1): ride offers expire 30 minutes after
--     their estimated end (`rides_expired_listings_sweep`, 0624) and requests never expire.
--   * `ride_templates_materialize` (0148, daily) published each active template's rides again
--     every night: the per-day unique index went with the table and the view drops
--     `template_id`. Recurring ride templates (FR-RIDE-021/022) are superseded by ride series
--     (FR-RIDE-046, `ride_series_sweep`).
--   * `ride_complete_pending_rating_cleanup` (0177) and `ride_food_overdue_alert` (0182)
--     match no row: the view has no `completed_pending_rating` or `in_transit` status and
--     reports `food_shipping_enabled = false`.
--   * `ride_participants_expire_stale_check` (0151) writes the retired `ride_participants`
--     table (G44).
--
-- The five jobs are unscheduled and their functions dropped. `food_expired_listings_sweep`
-- (0666) is rewritten on `posts` / `post_handoffs` only: its writes through the `listings` and
-- `giving_handoffs` views repeated the direct writes, and its second loop could never match.

-- ── 1. Unschedule the legacy ride jobs ─────────────────────────────────────────
do $$
declare
  v_job text;
begin
  -- pg_cron is absent from some local stacks; there is nothing to unschedule there.
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;
  foreach v_job in array array[
    'ride_listings_expire_check',
    'ride_templates_materialize',
    'ride_complete_pending_rating_cleanup_daily',
    'ride_food_overdue_alert_30m',
    'ride_participants_expire_stale_check'
  ] loop
    if exists (select 1 from cron.job where jobname = v_job) then
      perform cron.unschedule(v_job);
    end if;
  end loop;
end $$;

-- ── 2. Drop their functions (no other caller) ──────────────────────────────────
drop function if exists public.ride_listings_expire_check();
drop function if exists public.ride_templates_materialize();
drop function if exists public.ride_complete_pending_rating_cleanup();
drop function if exists public.ride_food_overdue_alert();
drop function if exists public.ride_participants_expire_stale_check();

-- ── 3. Food expiry on the post record only ─────────────────────────────────────
-- Hourly (`food_expired_listings_hourly`): an open food post past its expiry cancels its open
-- handoffs, becomes `expired` (S1 open → expired) and notifies its owner once.
create or replace function public.food_expired_listings_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_post record;     -- an expired food post, locked
  v_route_id uuid;   -- the id the notification opens (the listing id the screen expects)
begin
  for v_post in
    select p.post_id, p.owner_id, p.title
      from public.posts p
     where p.world_slug = 'food'
       and p.status = 'open'
       and p.expires_at is not null
       and p.expires_at <= now()
       for update
  loop
    update public.post_handoffs
       set status = 'cancelled', cancelled_at = now()
     where post_id = v_post.post_id
       and status in ('reserved', 'confirmed');

    update public.posts
       set status = 'expired', updated_at = now()
     where post_id = v_post.post_id;

    v_route_id := coalesce(public.listing_id_of_post(v_post.post_id), v_post.post_id);
    perform public.enqueue_notification(
      v_post.owner_id, 'critical', 'listing_expired',
      'notifications.foodExpiredTitle', 'notifications.foodExpiredBody',
      jsonb_build_object('listingTitle', coalesce(v_post.title, '')),
      jsonb_build_object('route', '/(tabs)/donations/marketplace/[listingId]',
                         'params', jsonb_build_object('listingId', v_route_id::text)),
      'food_expired:' || v_route_id::text,
      false
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.food_expired_listings_sweep() is
  'Hourly: open food posts past their expiry cancel their open handoffs, expire and notify the owner (D21, S4; 0695 on posts only).';

revoke all on function public.food_expired_listings_sweep() from public, anon, authenticated;
grant execute on function public.food_expired_listings_sweep() to service_role;
