-- 0338_listing_owner_and_profile | My listings management + public profile listings + karma on fulfill.

begin;

drop index if exists public.karma_ledger_once_idx;
create unique index karma_ledger_once_idx
  on public.karma_ledger (user_id, event_type, ref_id)
  where event_type in ('registration', 'post_created', 'outreach', 'backfill', 'listing_fulfilled');

create or replace function public.list_my_listings(
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  listing_id uuid,
  world_slug text,
  kind_slug text,
  direction text,
  status text,
  title text,
  summary text,
  urgency_level smallint,
  availability_status text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.listing_id,
    l.world_slug,
    lk.slug,
    l.direction,
    l.status,
    l.title,
    l.summary,
    l.urgency_level,
    l.availability_status,
    l.updated_at
  from public.listings l
  join public.listing_kinds lk on lk.kind_id = l.kind_id
  where l.owner_id = auth.uid()
    and l.status <> 'removed_admin'
  order by l.updated_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_my_listings(int, int) from public;
grant execute on function public.list_my_listings(int, int) to authenticated;

create or replace function public.list_profile_listings(
  p_owner_id uuid,
  p_limit int default 24
)
returns table (
  listing_id uuid,
  world_slug text,
  kind_slug text,
  direction text,
  status text,
  title text,
  summary text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.listing_id,
    l.world_slug,
    lk.slug,
    l.direction,
    l.status,
    l.title,
    l.summary
  from public.listings l
  join public.listing_kinds lk on lk.kind_id = l.kind_id
  where l.owner_id = p_owner_id
    and l.moderation_status = 'published'
    and l.status in ('open', 'closed')
    and public.is_listing_visible_to(l, auth.uid())
  order by l.published_at desc nulls last, l.created_at desc
  limit least(greatest(coalesce(p_limit, 24), 1), 50);
$$;

revoke all on function public.list_profile_listings(uuid, int) from public;
grant execute on function public.list_profile_listings(uuid, int) to anon, authenticated;

create or replace function public.update_my_listing(
  p_listing_id uuid,
  p_title text default null,
  p_summary text default null,
  p_details jsonb default null,
  p_city_id text default null,
  p_max_radius_km numeric default null,
  p_urgency_level smallint default null,
  p_availability_status text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.listings%rowtype;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_row from public.listings where listing_id = p_listing_id and owner_id = v_uid for update;
  if not found then raise exception 'listing_not_found' using errcode = 'P0002'; end if;
  if v_row.status not in ('open', 'cancelled') then
    raise exception 'listing_not_editable' using errcode = '23514';
  end if;
  if p_details is not null and not public.validate_listing_details(v_row.kind_id, p_details) then
    raise exception 'details_schema_mismatch' using errcode = '23514';
  end if;
  update public.listings set
    title = coalesce(nullif(trim(p_title), ''), title),
    summary = case when p_summary is null then summary else nullif(trim(p_summary), '') end,
    details = coalesce(p_details, details),
    city_id = coalesce(p_city_id, city_id),
    max_radius_km_override = coalesce(p_max_radius_km, max_radius_km_override),
    urgency_level = coalesce(p_urgency_level, urgency_level),
    availability_status = coalesce(p_availability_status, availability_status),
    geo = case
      when p_city_id is not null then public.listing_geo_from_city(p_city_id)
      else geo
    end,
    updated_at = now()
  where listing_id = p_listing_id;
end;
$$;

revoke all on function public.update_my_listing(uuid, text, text, jsonb, text, numeric, smallint, text) from public;
grant execute on function public.update_my_listing(uuid, text, text, jsonb, text, numeric, smallint, text) to authenticated;

create or replace function public.pause_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.listings
     set status = 'cancelled', availability_status = 'ongoing', updated_at = now()
   where listing_id = p_listing_id
     and owner_id = auth.uid()
     and status = 'open';
  if not found then raise exception 'listing_not_found' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.pause_my_listing(uuid) from public;
grant execute on function public.pause_my_listing(uuid) to authenticated;

create or replace function public.resume_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.listings
     set status = 'open', updated_at = now()
   where listing_id = p_listing_id
     and owner_id = auth.uid()
     and status = 'cancelled';
  if not found then raise exception 'listing_not_found' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.resume_my_listing(uuid) from public;
grant execute on function public.resume_my_listing(uuid) to authenticated;

create or replace function public.fulfill_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  update public.listings
     set status = 'closed', updated_at = now()
   where listing_id = p_listing_id
     and owner_id = v_uid
     and status = 'open';
  if not found then raise exception 'listing_not_found' using errcode = 'P0002'; end if;
  perform public.karma_grant_once(v_uid, 'listing_fulfilled', 'listing', p_listing_id::text, 4);
end;
$$;

revoke all on function public.fulfill_my_listing(uuid) from public;
grant execute on function public.fulfill_my_listing(uuid) to authenticated;

create or replace function public.delete_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.listing_media where listing_id = p_listing_id
    and exists (select 1 from public.listings l where l.listing_id = p_listing_id and l.owner_id = auth.uid());
  delete from public.listings
   where listing_id = p_listing_id
     and owner_id = auth.uid()
     and status in ('open', 'cancelled', 'closed');
  if not found then raise exception 'listing_not_found' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.delete_my_listing(uuid) from public;
grant execute on function public.delete_my_listing(uuid) to authenticated;

commit;
