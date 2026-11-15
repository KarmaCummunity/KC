-- supabase/tests/0320_marketplace_epic.sql — Epic #893 smoke (migrations 0320–0332).

begin;

do $$
declare
  v_cnt int;
begin
  select count(*) into v_cnt
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'listings'
     and column_name in ('urgency_level', 'availability_status');
  if v_cnt <> 2 then
    raise exception 'ASSERT FAILED: listings urgency/availability columns missing';
  end if;
end $$;

do $$
begin
  perform public.marketplace_search(null, null, 5, null);
  perform public.browse_listings(null, null, null, null, null, null, null, 5, 0, null);
exception
  when others then
    raise exception 'ASSERT FAILED: browse/search RPC: %', sqlerrm;
end $$;

commit;
