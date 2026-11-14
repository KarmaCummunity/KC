-- Foundation · function privileges are deny-by-default (ADR-002, migration
-- function_execute_default_deny): nothing in the application schemas is executable by PUBLIC,
-- the signed-out role reaches only the public-page allowlist, and every definer-rights
-- function pins its search_path.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(4);

create temporary view app_functions as
  select p.oid, n.nspname, p.prosecdef, p.proconfig
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'kc_private', 'kc_access', 'billing', 'integrations', 'ops', 'audit')
     and p.prokind in ('f', 'p')
     and not exists (select 1 from pg_catalog.pg_depend d
                      where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');

select is_empty(
  $$select oid::regprocedure::text from app_functions where has_function_privilege('public', oid, 'execute')$$,
  'no application function is executable by PUBLIC');

-- Opening a function to signed-out callers is a deliberate decision: extend this list in the
-- same change, with the reason in its migration.
select set_eq(
  $$select oid::regprocedure::text from app_functions where has_function_privilege('anon', oid, 'execute')$$,
  array[
    'community_stats()',
    'get_nonprofit_public_page(text)',
    'get_public_research_questions(text)',
    'list_kc_support_channels()',
    'list_verified_nonprofits(integer,text,uuid)',
    'post_share_card(uuid)',
    'rpc_org_transparency(text)'],
  'signed-out callers execute exactly the public-page allowlist');

select is_empty(
  $$select oid::regprocedure::text from app_functions
     where prosecdef
       and not exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%')$$,
  'every definer-rights function sets its search_path');

select ok(
  exists (select 1 from pg_catalog.pg_default_acl a
           where a.defaclrole = 'postgres'::regrole and a.defaclnamespace = 0 and a.defaclobjtype = 'f'
             and not exists (select 1 from aclexplode(a.defaclacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')),
  'new functions are not executable by PUBLIC by default');

select * from finish();
rollback;
