-- 0467_food_expiry_alerts | KC#1316 — food offers: alert the giver before and at expiry, and
-- record unclaimed expired food as `expired`.
--
-- docs/spec/05_giving_worlds.md §5.1: "unclaimed offers auto-close at expiry, alert 24h before";
-- S4 (working assumption, pending approval): alert 24 h before and at expiry.
--
--   1. `food_expired_listings_sweep` (`0387`) set unclaimed expired food to `closed`, the status of
--      a completed handoff, so food nobody took showed as "completed" and counted with real
--      giving. It now sets `expired` (as `listings_food_expiry_block` does at insert), still
--      cancels open handoffs, and tells the giver.
--   2. `notifications_food_expiry_check()` tells the giver once when an open food offer has
--      24 hours or less left. Runs hourly.
--   3. Backfill: food the old sweep closed (closed at or after its expiry, no handed-over handoff)
--      becomes `expired`.
--
-- Notices are de-duplicated per listing (`enqueue_notification` dedupe keys) and open the listing.
-- Idempotent.

begin;

-- ── 1. Expired food is `expired`, and its giver is told ──────────────────
create or replace function public.food_expired_listings_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    select listing_id, owner_id, title from public.listings
     where world_slug = 'food'
       and status = 'open'
       and expires_at is not null
       and expires_at <= now()
  loop
    update public.giving_handoffs
       set status = 'cancelled', cancelled_at = now()
     where listing_id = r.listing_id and status in ('reserved', 'confirmed');

    -- KC#1316: unclaimed food expired; `closed` is reserved for a completed handoff.
    update public.listings
       set status = 'expired', updated_at = now()
     where listing_id = r.listing_id;

    perform public.enqueue_notification(
      r.owner_id, 'critical', 'listing_expired',
      'notifications.foodExpiredTitle', 'notifications.foodExpiredBody',
      jsonb_build_object('listingTitle', coalesce(r.title, '')),
      jsonb_build_object('route', '/(tabs)/donations/marketplace/[listingId]',
                         'params', jsonb_build_object('listingId', r.listing_id::text)),
      'food_expired:' || r.listing_id::text,
      false
    );

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ── 2. One notice when 24 hours or less are left ──────────────────────────
create or replace function public.notifications_food_expiry_check()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    select listing_id, owner_id, title from public.listings
     where world_slug = 'food'
       and direction = 'give'
       and status = 'open'
       and expires_at > now()
       and expires_at <= now() + interval '24 hours'
  loop
    -- The dedupe key makes the hourly run idempotent: one notice per listing.
    perform public.enqueue_notification(
      r.owner_id, 'critical', 'listing_expiring',
      'notifications.foodExpiringTitle', 'notifications.foodExpiringBody',
      jsonb_build_object('listingTitle', coalesce(r.title, '')),
      jsonb_build_object('route', '/(tabs)/donations/marketplace/[listingId]',
                         'params', jsonb_build_object('listingId', r.listing_id::text)),
      'food_expiring:' || r.listing_id::text,
      false
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function public.notifications_food_expiry_check() is
  'Hourly: one notice to the giver of each open food offer with 24 hours or less left (spec 05 §5.1, S4). KC#1316.';

revoke all on function public.notifications_food_expiry_check() from public, anon, authenticated;
grant execute on function public.notifications_food_expiry_check() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'food_expiry_alert_hourly') then
      perform cron.unschedule('food_expiry_alert_hourly');
    end if;
    perform cron.schedule(
      'food_expiry_alert_hourly',
      '5 * * * *',
      $sql$ select public.notifications_food_expiry_check(); $sql$
    );
  else
    raise notice 'pg_cron not enabled — food_expiry_alert_hourly not scheduled.';
  end if;
end $$;

-- ── 3. Backfill food the old sweep closed ────────────────────────────────
-- Only food closed at or after its expiry with no handed-over handoff: a completed handoff or a
-- giver's own "fulfilled" (which needs an open listing, so happens before the sweep) keeps `closed`.
update public.listings l
   set status = 'expired'
 where l.world_slug = 'food'
   and l.status = 'closed'
   and l.expires_at is not null
   and l.updated_at >= l.expires_at
   and not exists (
     select 1 from public.giving_handoffs h
      where h.listing_id = l.listing_id and h.status = 'handed_over'
   );

commit;
