-- 0379_volunteer_close_opportunity | Organizer close + grants hygiene.

begin;

create or replace function public.close_volunteer_opportunity(p_opportunity_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.volunteer_opportunities
     set status = 'closed', updated_at = now()
   where opportunity_id = p_opportunity_id and organizer_id = auth.uid();
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.close_volunteer_opportunity(uuid) from public;
grant execute on function public.close_volunteer_opportunity(uuid) to authenticated;

commit;
