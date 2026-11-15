-- 0387_food_expired_listings_sweep | Close expired food listings + cancel active handoffs.

begin;

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
    select listing_id from public.listings
     where world_slug = 'food'
       and status = 'open'
       and expires_at is not null
       and expires_at <= now()
  loop
    update public.giving_handoffs
       set status = 'cancelled', cancelled_at = now()
     where listing_id = r.listing_id and status in ('reserved', 'confirmed');

    update public.listings
       set status = 'closed', updated_at = now()
     where listing_id = r.listing_id;

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.food_expired_listings_sweep() from public;
grant execute on function public.food_expired_listings_sweep() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'food_expired_listings_hourly') then
      perform cron.unschedule('food_expired_listings_hourly');
    end if;
    perform cron.schedule(
      'food_expired_listings_hourly',
      '15 * * * *',
      $sql$ select public.food_expired_listings_sweep(); $sql$
    );
    if exists (select 1 from cron.job where jobname = 'giving_handoff_no_show_hourly') then
      perform cron.unschedule('giving_handoff_no_show_hourly');
    end if;
    perform cron.schedule(
      'giving_handoff_no_show_hourly',
      '45 * * * *',
      $sql$ select public.giving_handoff_no_show_sweep(); $sql$
    );
  else
    raise notice 'pg_cron not enabled — food/no_show sweeps not scheduled.';
  end if;
end $$;

commit;
