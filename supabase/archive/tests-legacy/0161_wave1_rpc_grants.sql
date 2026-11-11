-- Wave 1 / TD-161 — anon must not EXECUTE research submit or has_admin_role.
--
-- Catalog probe (has_function_privilege) instead of SET ROLE + PERFORM: calling
-- SECURITY DEFINER RPCs as anon can crash the backend in CI Docker Postgres.

create or replace function pg_temp.assert(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERT FAILED: %', p_msg; end if;
end $$;

do $$
declare
  v_has_exec boolean;
begin
  select has_function_privilege(
    'anon',
    'public.submit_public_research_response(text,int,text,text,text,jsonb,text,text,text)',
    'execute'
  ) into v_has_exec;
  perform pg_temp.assert(
    not v_has_exec,
    'anon must not EXECUTE submit_public_research_response'
  );
  raise notice '✓ anon submit_public_research_response denied';

  select has_function_privilege(
    'anon',
    'public.has_admin_role(uuid,text)',
    'execute'
  ) into v_has_exec;
  perform pg_temp.assert(
    not v_has_exec,
    'anon must not EXECUTE has_admin_role'
  );
  raise notice '✓ anon has_admin_role denied';
end $$;
