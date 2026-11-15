-- 0372_volunteer_browse_rpcs | Public browse + detail with shift slots.

begin;

create or replace function public.list_volunteer_opportunities(p_limit int default 30, p_offset int default 0)
returns table (
  opportunity_id uuid,
  title text,
  summary text,
  location_label text,
  city_id text,
  next_shift_at timestamptz,
  open_slots int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.opportunity_id,
    o.title,
    o.summary,
    o.location_label,
    o.city_id,
    min(s.starts_at) filter (where s.starts_at > now()) as next_shift_at,
    coalesce(sum(
      greatest(0, s.capacity - (
        select count(*)::int from public.volunteer_shift_signups su
         where su.shift_id = s.shift_id and su.status in ('registered','checked_in')
      ))
    ), 0)::int as open_slots
  from public.volunteer_opportunities o
  left join public.volunteer_shifts s on s.opportunity_id = o.opportunity_id and s.ends_at > now()
  where o.status = 'open'
  group by o.opportunity_id, o.title, o.summary, o.location_label, o.city_id
  order by next_shift_at nulls last, o.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.get_volunteer_opportunity_detail(p_opportunity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_o public.volunteer_opportunities%rowtype;
  v_shifts jsonb;
begin
  select * into v_o from public.volunteer_opportunities
   where opportunity_id = p_opportunity_id
     and (status = 'open' or organizer_id = auth.uid());
  if not found then return null; end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.starts_at), '[]'::jsonb)
    into v_shifts
  from (
    select
      s.shift_id,
      s.starts_at,
      s.ends_at,
      s.capacity,
      (select count(*)::int from public.volunteer_shift_signups su
        where su.shift_id = s.shift_id and su.status in ('registered','checked_in')) as filled,
      greatest(0, s.capacity - (
        select count(*)::int from public.volunteer_shift_signups su
         where su.shift_id = s.shift_id and su.status in ('registered','checked_in')
      )) as slots_open,
      (select su.status from public.volunteer_shift_signups su
        where su.shift_id = s.shift_id and su.user_id = auth.uid()
        limit 1) as my_status
    from public.volunteer_shifts s
    where s.opportunity_id = p_opportunity_id and s.ends_at > now() - interval '1 day'
  ) x;

  return jsonb_build_object(
    'opportunity_id', v_o.opportunity_id,
    'organizer_id', v_o.organizer_id,
    'title', v_o.title,
    'summary', v_o.summary,
    'location_label', v_o.location_label,
    'city_id', v_o.city_id,
    'status', v_o.status,
    'shifts', v_shifts
  );
end;
$$;

revoke all on function public.list_volunteer_opportunities(int, int) from public;
grant execute on function public.list_volunteer_opportunities(int, int) to authenticated;
revoke all on function public.get_volunteer_opportunity_detail(uuid) from public;
grant execute on function public.get_volunteer_opportunity_detail(uuid) to authenticated;

commit;
