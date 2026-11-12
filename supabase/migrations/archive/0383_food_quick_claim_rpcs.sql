-- 0383_food_quick_claim_rpcs | Food rescue quick-claim + urgency from expiry.

begin;

create or replace function public.food_listing_urgency_level(p_expires_at timestamptz)
returns smallint
language sql
immutable
as $$
  select case
    when p_expires_at is null then 2
    when p_expires_at <= now() + interval '6 hours' then 5
    when p_expires_at <= now() + interval '24 hours' then 4
    when p_expires_at <= now() + interval '72 hours' then 3
    else 2
  end::smallint;
$$;

create or replace function public.listings_food_urgency_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.world_slug = 'food' and new.expires_at is not null then
    new.urgency_level := public.food_listing_urgency_level(new.expires_at);
  end if;
  return new;
end;
$$;

drop trigger if exists listings_food_urgency_sync on public.listings;
create trigger listings_food_urgency_sync
  before insert or update of expires_at, world_slug on public.listings
  for each row execute function public.listings_food_urgency_sync();

create or replace function public.claim_food_giving(
  p_listing_id uuid,
  p_pickup_window_start timestamptz default null,
  p_pickup_window_end timestamptz default null
)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_l public.listings%rowtype;
  v_row public.giving_handoffs;
  v_start timestamptz;
  v_end timestamptz;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_l from public.listings
   where listing_id = p_listing_id
     and world_slug = 'food'
     and direction = 'give'
     and status = 'open'
     and (expires_at is null or expires_at > now());
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  if v_l.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if;

  v_start := coalesce(p_pickup_window_start, (v_l.details->>'pickup_window_start')::timestamptz, now());
  v_end := coalesce(
    p_pickup_window_end,
    (v_l.details->>'pickup_window_end')::timestamptz,
    coalesce(v_l.expires_at, now() + interval '4 hours')
  );

  insert into public.giving_handoffs (
    listing_id, owner_id, recipient_id, world_slug, status,
    pickup_mode, pickup_window_start, pickup_window_end, confirmed_at
  ) values (
    p_listing_id, v_l.owner_id, v_uid, 'food', 'confirmed',
    'pickup', v_start, v_end, now()
  )
  returning * into v_row;

  update public.listings
     set availability_status = 'scheduled', urgency_level = public.food_listing_urgency_level(v_l.expires_at),
         updated_at = now()
   where listing_id = p_listing_id;

  return v_row;
end;
$$;

revoke all on function public.claim_food_giving(uuid, timestamptz, timestamptz) from public;
grant execute on function public.claim_food_giving(uuid, timestamptz, timestamptz) to authenticated;

commit;
