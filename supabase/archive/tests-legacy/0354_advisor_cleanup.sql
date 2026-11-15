-- 0354–0356 advisor cleanup smoke checks (KC#945).
-- pg_policies stores quals with optional whitespace / SELECT casing
-- e.g. ( SELECT auth.uid() AS uid ) — match that, not only lowercase compact form.

do $$
declare
  v_bare integer;
  v_missing_sp integer;
  v_select_pols integer;
begin
  select count(*) into v_bare
    from pg_policies
   where schemaname = 'public'
     and tablename = 'listing_user_signals'
     and (
       (qual is not null and qual ~ 'auth\.uid\(\)' and qual !~* '\(\s*select\s+auth\.uid\(\)')
       or (with_check is not null and with_check ~ 'auth\.uid\(\)' and with_check !~* '\(\s*select\s+auth\.uid\(\)')
     );
  if v_bare > 0 then
    raise exception 'advisor cleanup: % listing_user_signals policies still use bare auth.uid()', v_bare;
  end if;

  if to_regclass('public.listing_user_signals_listing_idx') is null then
    raise exception 'advisor cleanup: missing listing_user_signals_listing_idx';
  end if;

  if to_regclass('public.volunteer_opportunities') is not null then
    select count(*) into v_bare
      from pg_policies
     where schemaname = 'public'
       and tablename in (
         'volunteer_opportunities',
         'volunteer_shifts',
         'volunteer_shift_signups'
       )
       and (
         (qual is not null and qual ~ 'auth\.uid\(\)' and qual !~* '\(\s*select\s+auth\.uid\(\)')
         or (with_check is not null and with_check ~ 'auth\.uid\(\)' and with_check !~* '\(\s*select\s+auth\.uid\(\)')
       );
    if v_bare > 0 then
      raise exception 'advisor cleanup: % volunteer policies still use bare auth.uid()', v_bare;
    end if;

    select count(*) into v_select_pols
      from pg_policies
     where schemaname = 'public'
       and tablename = 'volunteer_shift_signups'
       and cmd = 'SELECT';
    if v_select_pols <> 1 then
      raise exception 'advisor cleanup: expected exactly one SELECT policy on volunteer_shift_signups, got %', v_select_pols;
    end if;

    if to_regclass('public.volunteer_shifts_opportunity_idx') is null then
      raise exception 'advisor cleanup: missing volunteer_shifts_opportunity_idx';
    end if;
  end if;

  if to_regclass('public.giving_handoff_ratings') is not null then
    select count(*) into v_bare
      from pg_policies
     where schemaname = 'public'
       and tablename in ('giving_handoffs', 'giving_handoff_ratings')
       and (
         (qual is not null and qual ~ 'auth\.uid\(\)' and qual !~* '\(\s*select\s+auth\.uid\(\)')
         or (with_check is not null and with_check ~ 'auth\.uid\(\)' and with_check !~* '\(\s*select\s+auth\.uid\(\)')
       );
    if v_bare > 0 then
      raise exception 'advisor cleanup: % giving policies still use bare auth.uid()', v_bare;
    end if;
    if to_regclass('public.giving_handoff_ratings_handoff_idx') is null then
      raise exception 'advisor cleanup: missing giving_handoff_ratings_handoff_idx';
    end if;
  end if;

  select count(*) into v_missing_sp
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and (
       p.proconfig is null
       or not exists (
         select 1 from unnest(p.proconfig) as c(cfg)
          where c.cfg like 'search_path=%'
       )
     );

  if v_missing_sp > 0 then
    raise exception 'advisor cleanup: % SECURITY DEFINER functions lack search_path', v_missing_sp;
  end if;
end $$;

\echo '✓ 0354_advisor_cleanup.sql passed'
