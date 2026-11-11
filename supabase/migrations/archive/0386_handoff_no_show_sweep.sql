-- 0386_handoff_no_show_sweep | Mark confirmed handoffs past pickup window as no_show.

begin;

create or replace function public.giving_handoff_no_show_sweep()
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
    select handoff_id, listing_id
      from public.giving_handoffs
     where status = 'confirmed'
       and pickup_window_end is not null
       and pickup_window_end < now() - interval '2 hours'
  loop
    update public.giving_handoffs
       set status = 'no_show', no_show_at = now()
     where handoff_id = r.handoff_id;

    update public.listings
       set availability_status = 'immediate', updated_at = now()
     where listing_id = r.listing_id and status = 'open';

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.giving_handoff_no_show_sweep() from public;
grant execute on function public.giving_handoff_no_show_sweep() to service_role;

commit;
