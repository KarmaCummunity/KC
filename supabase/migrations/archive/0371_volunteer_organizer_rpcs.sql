-- 0371_volunteer_organizer_rpcs | Create/publish opportunities and shifts.

begin;

create or replace function public.create_volunteer_opportunity(
  p_title text,
  p_summary text default null,
  p_location_label text default null,
  p_city_id text default null,
  p_org_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if nullif(trim(p_title), '') is null then
    raise exception 'title_required' using errcode = '23514';
  end if;
  insert into public.volunteer_opportunities (
    organizer_id, org_id, title, summary, location_label, city_id, status
  ) values (
    v_uid, p_org_id, trim(p_title), nullif(trim(p_summary), ''), nullif(trim(p_location_label), ''), p_city_id, 'draft'
  )
  returning opportunity_id into v_id;
  return v_id;
end;
$$;

create or replace function public.add_volunteer_shift(
  p_opportunity_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_capacity int default 10
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if not exists (
    select 1 from public.volunteer_opportunities
     where opportunity_id = p_opportunity_id and organizer_id = v_uid
  ) then
    raise exception 'not_organizer' using errcode = '42501';
  end if;
  insert into public.volunteer_shifts (opportunity_id, starts_at, ends_at, capacity)
  values (p_opportunity_id, p_starts_at, p_ends_at, greatest(1, least(coalesce(p_capacity, 10), 500)))
  returning shift_id into v_id;
  return v_id;
end;
$$;

create or replace function public.publish_volunteer_opportunity(p_opportunity_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.volunteer_opportunities
     set status = 'open', updated_at = now()
   where opportunity_id = p_opportunity_id
     and organizer_id = auth.uid()
     and status = 'draft'
     and exists (select 1 from public.volunteer_shifts s where s.opportunity_id = p_opportunity_id);
  if not found then raise exception 'publish_failed' using errcode = '23514'; end if;
end;
$$;

create or replace function public.list_my_volunteer_opportunities(p_limit int default 50)
returns setof public.volunteer_opportunities
language sql
stable
security definer
set search_path = public
as $$
  select o.*
    from public.volunteer_opportunities o
   where o.organizer_id = auth.uid()
   order by o.updated_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke all on function public.create_volunteer_opportunity(text, text, text, text, uuid) from public;
grant execute on function public.create_volunteer_opportunity(text, text, text, text, uuid) to authenticated;
revoke all on function public.add_volunteer_shift(uuid, timestamptz, timestamptz, int) from public;
grant execute on function public.add_volunteer_shift(uuid, timestamptz, timestamptz, int) to authenticated;
revoke all on function public.publish_volunteer_opportunity(uuid) from public;
grant execute on function public.publish_volunteer_opportunity(uuid) to authenticated;
revoke all on function public.list_my_volunteer_opportunities(int) from public;
grant execute on function public.list_my_volunteer_opportunities(int) to authenticated;

commit;
