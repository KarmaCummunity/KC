-- Regression for 0537_rpc_input_bounds: browse coordinates are validated and
-- radius / legacy offset inputs are bounded. Runs in a rolled-back transaction.
\set ON_ERROR_STOP on

begin;

select kc_test.create_user('rpc_bounds_viewer') as viewer \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);

do $$
begin
  begin
    perform * from public.browse_listings(p_lat => 91, p_lng => 0, p_viewer => auth.uid());
    raise exception 'expected invalid latitude to be rejected';
  exception when sqlstate '22023' then
    if sqlerrm <> 'invalid_input' then raise; end if;
  end;

  begin
    perform * from public.browse_listings(p_lat => 10, p_lng => null, p_viewer => auth.uid());
    raise exception 'expected partial coordinates to be rejected';
  exception when sqlstate '22023' then
    if sqlerrm <> 'invalid_input' then raise; end if;
  end;

  if (select count(*) from public.browse_listings(p_lat => 31.7, p_lng => 35.2, p_radius_km => 500, p_limit => 1, p_viewer => auth.uid())) > 1 then
    raise exception 'normal browse input exceeded the requested page size';
  end if;

  if (select count(*) from public.browse_listings(p_offset => 1000000000, p_limit => 50, p_viewer => auth.uid()))
     <> (select count(*) from public.browse_listings(p_offset => 10000, p_limit => 50, p_viewer => auth.uid())) then
    raise exception 'oversized offset was not clamped to 10000';
  end if;

  if (select count(*) from public.browse_listings(p_lat => 31.7, p_lng => 35.2, p_radius_km => 100000, p_limit => 50, p_viewer => auth.uid()))
     <> (select count(*) from public.browse_listings(p_lat => 31.7, p_lng => 35.2, p_radius_km => 500, p_limit => 50, p_viewer => auth.uid())) then
    raise exception 'oversized radius was not clamped to 500 km';
  end if;
end;
$$;

rollback;

\echo '✓ 0537 RPC input bounds regression test passed'
