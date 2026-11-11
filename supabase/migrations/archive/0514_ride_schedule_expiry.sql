-- 0514_ride_schedule_expiry | Estimated end of a ride and auto-close after it
-- (docs/spec/05_giving_worlds.md §5.3 steps 1 and 7, D21, D75; approved fill S46; gap G49).
--
--   1. Ride details gain `arrives_at` — the estimated end the form suggests (S46) and the
--      driver may edit.
--   2. listings_ride_schedule — on every native ride write: an estimated end must come after
--      the departure; a ride offer expires 30 minutes after its estimated end, or after its
--      departure when it has none (D21). Ride requests never expire (D21).
--   3. rides_expired_listings_sweep (every 10 min) — open ride offers past their expiry become
--      `expired`, so they leave the feed and stop taking bookings.

begin;

-- ── 1. Estimated end ────────────────────────────────────────────────────────
update public.listing_kinds
   set detail_schema = jsonb_set(
         detail_schema, '{properties}',
         (detail_schema->'properties') || '{"arrives_at":{"type":"string","format":"date-time"}}'::jsonb)
 where world_slug = 'rides' and slug in ('ride_offer', 'ride_request');

-- ── 2. Times are consistent; offers expire after the ride ────────────────────
create or replace function public.listings_ride_schedule()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_departs timestamptz;
  v_arrives timestamptz;
begin
  if new.world_slug <> 'rides' or new.origin <> 'native' then return new; end if;

  begin
    v_departs := nullif(new.details->>'departs_at', '')::timestamptz;
    v_arrives := nullif(new.details->>'arrives_at', '')::timestamptz;
  exception
    when invalid_datetime_format or datetime_field_overflow then
      raise exception 'ride_time_invalid' using errcode = '23514';
  end;

  if v_arrives is not null and v_departs is not null and v_arrives <= v_departs then
    raise exception 'ride_arrival_before_departure' using errcode = '23514';
  end if;

  if new.direction = 'give' and coalesce(v_arrives, v_departs) is not null then
    new.expires_at := coalesce(v_arrives, v_departs) + interval '30 minutes';
  end if;
  return new;
end;
$$;

drop trigger if exists listings_ride_schedule on public.listings;
create trigger listings_ride_schedule
  before insert or update of details on public.listings
  for each row execute function public.listings_ride_schedule();

-- ── 3. Ride offers past their expiry close ───────────────────────────────────
create or replace function public.rides_expired_listings_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.listings
     set status = 'expired', updated_at = now()
   where world_slug = 'rides'
     and direction = 'give'
     and status = 'open'
     and expires_at is not null
     and expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.rides_expired_listings_sweep() is
  'Every 10 min: open ride offers 30 min past their estimated end (or departure) become expired (D21).';

revoke all on function public.rides_expired_listings_sweep() from public, anon, authenticated;
revoke all on function public.listings_ride_schedule() from public, anon, authenticated;
grant execute on function public.rides_expired_listings_sweep() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'rides_expired_listings_sweep') then
      perform cron.unschedule('rides_expired_listings_sweep');
    end if;
    perform cron.schedule(
      'rides_expired_listings_sweep',
      '*/10 * * * *',
      $sql$ select public.rides_expired_listings_sweep(); $sql$
    );
  else
    raise notice 'pg_cron not enabled — rides_expired_listings_sweep not scheduled.';
  end if;
end $$;

commit;
