-- rls-lint.sql — every public table must have RLS enabled and at least one policy.
-- Run after `supabase start` / `supabase db reset` in CI.

do $$
declare
  r record;
  v_policy_count integer;
begin
  for r in
    select c.relname as table_name, c.relrowsecurity as rls_enabled
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relname not like 'pg_%'
     order by c.relname
  loop
    if not r.rls_enabled then
      raise exception 'RLS lint: public.% has rowsecurity = false', r.table_name;
    end if;

    select count(*) into v_policy_count
      from pg_policies
     where schemaname = 'public'
       and tablename = r.table_name;

    if v_policy_count = 0 then
      raise exception 'RLS lint: public.% has RLS enabled but zero policies', r.table_name;
    end if;
  end loop;
end $$;

\echo '✓ rls-lint.sql passed — all public tables have RLS + policies'
