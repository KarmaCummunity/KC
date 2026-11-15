-- 0356_advisor_security_definer_search_path | KC#945 — pin search_path on SECURITY DEFINER
-- functions that still lack it (function_search_path_mutable advisor).

begin;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as regproc
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
       )
  loop
    execute format('alter function %s set search_path = public', r.regproc);
  end loop;
end $$;

commit;
