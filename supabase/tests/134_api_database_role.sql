-- The API server's database user (ADR-009 phase 2): it may become each of the three request
-- roles, and is nothing until it does.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(5);

select ok(
  (select rolcanlogin and not rolinherit from pg_roles where rolname = 'kc_api'),
  'kc_api signs in and inherits nothing from the roles it is a member of'
);

select ok(
  (select not (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls) from pg_roles where rolname = 'kc_api'),
  'kc_api has no attribute of its own: not a superuser, creates no role or database, does not bypass row security'
);

select ok(
  pg_has_role('kc_api', 'anon', 'SET') and pg_has_role('kc_api', 'authenticated', 'SET') and pg_has_role('kc_api', 'service_role', 'SET'),
  'kc_api may switch to anon, authenticated and service_role'
);

select ok(
  not (pg_has_role('kc_api', 'anon', 'USAGE') or pg_has_role('kc_api', 'authenticated', 'USAGE') or pg_has_role('kc_api', 'service_role', 'USAGE')),
  'without switching, kc_api has the rights of none of them'
);

select ok(
  not has_table_privilege('kc_api', 'public.users', 'select') and not has_schema_privilege('kc_api', 'kc_private', 'usage'),
  'as itself kc_api reads no table and enters no private schema'
);

-- Signing in as kc_api and switching role is not repeated here (it needs a superuser to imitate):
-- the API's own suites run with the server connected as kc_api (ci-backend.yml).

select * from finish();
rollback;
