-- Foundation · function EXECUTE is deny-by-default (least privilege, ADR-002)
--
-- The baseline already makes new functions private (`alter default privileges … revoke
-- execute on functions from public`, 00_foundation/020_default_privileges) and grants the
-- client roles per function. This migration re-asserts that rule on every function that
-- exists now, so a function created outside that path (an earlier hand-applied change, an
-- object created before the default privileges took effect) cannot stay open:
--   1. nothing in the application schemas is executable by PUBLIC;
--   2. the signed-out role `anon` keeps EXECUTE only on the functions of the allowlist below,
--      the public pages a signed-out visitor or a link-preview crawler needs.
-- Grants to `authenticated` and `service_role` are explicit per function and are left as
-- they are. Functions that belong to an extension are not touched. Idempotent: on a database
-- that already follows the rule it changes nothing. pgTAP `094_function_privileges.sql`
-- pins the same rule, so a later migration that opens a function to anon must also extend
-- the allowlist there.

alter default privileges for role postgres revoke execute on functions from public;

do $$
declare
  -- Functions a signed-out caller may execute (each one restates its own row rules).
  c_anon_allowlist constant text[] := array[
    'public.community_stats()',
    'public.get_nonprofit_public_page(text)',
    'public.get_public_research_questions(text)',
    'public.list_kc_support_channels()',
    'public.list_verified_nonprofits(integer,text,uuid)',
    'public.post_share_card(uuid)',
    'public.rpc_org_transparency(text)'];
  f record;
begin
  for f in
    select p.oid,
           case p.prokind when 'p' then 'procedure' else 'function' end as kind
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'kc_private', 'kc_access', 'billing', 'integrations', 'ops', 'audit')
       and p.prokind in ('f', 'p')
       and pg_catalog.pg_get_userbyid(p.proowner) = current_user
       and not exists (select 1 from pg_catalog.pg_depend d
                        where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    if pg_catalog.has_function_privilege('public', f.oid, 'execute') then
      execute format('revoke execute on %s %s from public', f.kind, f.oid::regprocedure);
    end if;
    if pg_catalog.has_function_privilege('anon', f.oid, 'execute')
       and f.oid <> all (select pg_catalog.to_regprocedure(a)::oid from unnest(c_anon_allowlist) a
                          where pg_catalog.to_regprocedure(a) is not null) then
      execute format('revoke execute on %s %s from anon', f.kind, f.oid::regprocedure);
    end if;
  end loop;
end $$;
