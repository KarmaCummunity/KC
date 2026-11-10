-- Foundation · privileges
--
-- Least privilege by grant, not by RLS alone. Supabase ships `public` with blanket default
-- grants to the API roles; this file removes them, so that from here on an object is
-- reachable only when the file that creates it grants it explicitly.

-- Functions: PostgreSQL grants EXECUTE to PUBLIC on every new function. Remove that default for
-- everything this role creates, in every schema.
alter default privileges for role postgres revoke execute on functions from public;

-- `public`: drop the platform's blanket defaults for the two client roles.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

-- Objects that already exist in `public` on a fresh project lose the same blanket grants.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- Private schemas: no client role may even resolve a name in them. The service role (Edge
-- Functions, scheduled jobs) gets full access; it bypasses RLS by design.
do $$
declare
  v_schema text;
begin
  foreach v_schema in array array['kc_private', 'billing', 'audit', 'integrations', 'ops'] loop
    execute format('revoke all on schema %I from public, anon, authenticated', v_schema);
    execute format('grant usage on schema %I to service_role', v_schema);
    execute format(
      'alter default privileges for role postgres in schema %I grant all on tables to service_role', v_schema);
    execute format(
      'alter default privileges for role postgres in schema %I grant all on sequences to service_role', v_schema);
    execute format(
      'alter default privileges for role postgres in schema %I grant execute on functions to service_role', v_schema);
  end loop;
end $$;

-- `public` functions stay callable by the service role without a per-function grant.
alter default privileges for role postgres in schema public grant execute on functions to service_role;
