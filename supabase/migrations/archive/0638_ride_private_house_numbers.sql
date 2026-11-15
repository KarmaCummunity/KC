-- 0638_ride_private_house_numbers.sql | FR-RIDE-003 AC9: an optional house number for a ride's
-- origin / destination street, kept private. The public listing (and its feed post) carries only
-- the official place — city, street or junction (D71); the number lives here and is readable only
-- by the driver and by passengers whose booking the driver approved (status confirmed /
-- handed_over, 0511). No direct table access: two RPCs. Additive and idempotent.

begin;

create table if not exists public.ride_listing_house_numbers (
  listing_id   uuid not null references public.listings (listing_id) on delete cascade,
  place_end    text not null check (place_end in ('origin', 'dest')),
  house_number text not null check (house_number ~ '^[0-9]{1,4}[א-תA-Za-z]?$'),
  updated_at   timestamptz not null default now(),
  primary key (listing_id, place_end)
);

comment on table public.ride_listing_house_numbers is
  'FR-RIDE-003 AC9: private house numbers of a ride''s street origin / destination. Read via get_ride_house_numbers only.';

alter table public.ride_listing_house_numbers enable row level security;
revoke all on table public.ride_listing_house_numbers from public, anon, authenticated;

-- ── Write: the driver sets (or clears, with null / blank) both numbers at once ─────────────────
create or replace function public.set_ride_house_numbers(
  p_listing_id uuid,
  p_origin text default null,
  p_dest text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing_id uuid := public.handoff_target_listing_id(p_listing_id);
  v_details jsonb;
  v_end text;
  v_number text;
begin
  select l.details into v_details
    from public.listings l
   where l.listing_id = v_listing_id and l.world_slug = 'rides' and l.owner_id = auth.uid();
  if not found then
    raise exception 'owner_only' using errcode = '42501';
  end if;

  foreach v_end in array array['origin', 'dest'] loop
    v_number := nullif(btrim(case v_end when 'origin' then p_origin else p_dest end), '');
    if v_number is null then
      delete from public.ride_listing_house_numbers where listing_id = v_listing_id and place_end = v_end;
      continue;
    end if;
    -- A number belongs to a street; a city or a junction has no house numbers.
    if coalesce(v_details ->> (v_end || '_place_kind'), '') <> 'street' then
      raise exception 'ride_house_number_not_street' using errcode = '22023';
    end if;
    if v_number !~ '^[0-9]{1,4}[א-תA-Za-z]?$' then
      raise exception 'ride_house_number_invalid' using errcode = '22023';
    end if;
    insert into public.ride_listing_house_numbers (listing_id, place_end, house_number)
    values (v_listing_id, v_end, v_number)
    on conflict (listing_id, place_end)
      do update set house_number = excluded.house_number, updated_at = now();
  end loop;
end;
$$;

comment on function public.set_ride_house_numbers(uuid, text, text) is
  'FR-RIDE-003 AC9: the ride owner sets / clears the private house numbers (street ends only).';

revoke all on function public.set_ride_house_numbers(uuid, text, text) from public, anon;
grant execute on function public.set_ride_house_numbers(uuid, text, text) to authenticated;

-- ── Read: the driver and approved passengers; everyone else gets no rows ───────────────────────
create or replace function public.get_ride_house_numbers(p_listing_id uuid)
returns table (place_end text, house_number text)
language sql
stable
security definer
set search_path = public
as $$
  with target as (select public.handoff_target_listing_id(p_listing_id) as listing_id)
  select n.place_end, n.house_number
    from public.ride_listing_house_numbers n
    join target t on t.listing_id = n.listing_id
   where auth.uid() is not null
     and (
       exists (select 1 from public.listings l where l.listing_id = t.listing_id and l.owner_id = auth.uid())
       or exists (
         select 1 from public.giving_handoffs h
          where h.listing_id = t.listing_id
            and h.recipient_id = auth.uid()
            and h.status in ('confirmed', 'handed_over'))
     );
$$;

comment on function public.get_ride_house_numbers(uuid) is
  'FR-RIDE-003 AC9: private house numbers of a ride, for its owner and approved passengers only (else no rows).';

revoke all on function public.get_ride_house_numbers(uuid) from public, anon;
grant execute on function public.get_ride_house_numbers(uuid) to authenticated;

commit;
