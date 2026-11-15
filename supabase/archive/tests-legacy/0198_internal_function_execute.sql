-- supabase/tests/0198_internal_function_execute.sql
-- Regression for migration 0198 (security audit 2026-06-14).
--
-- Internal SECURITY DEFINER helpers must NOT be EXECUTE-able by client roles
-- (anon/authenticated); only triggers, cron, and gated wrapper functions (which
-- run as the owner) may call them. The gated wrappers the app actually uses must
-- remain callable. Runs in a rolled-back transaction.

begin;

do $$
begin
  -- The five internal helpers are now off-limits to clients.
  if has_function_privilege('authenticated','public.karma_apply(uuid,text,text,text,integer)','EXECUTE')
     or has_function_privilege('anon','public.karma_apply(uuid,text,text,text,integer)','EXECUTE')
     or has_function_privilege('authenticated','public.karma_grant_once(uuid,text,text,text,integer)','EXECUTE')
     or has_function_privilege('authenticated','public.inject_system_message(uuid,jsonb,text)','EXECUTE')
     or has_function_privilege('anon','public.inject_system_message(uuid,jsonb,text)','EXECUTE')
     or has_function_privilege('authenticated','public.admin_audit_lookup(uuid,integer)','EXECUTE')
     or has_function_privilege('authenticated','public.find_or_create_support_chat(uuid)','EXECUTE') then
    raise exception 'SECURITY REGRESSION: a client role can EXECUTE an internal SECURITY DEFINER helper';
  end if;

  -- The gated admin-audit wrapper the app calls must still work (it self-checks is_admin).
  if not has_function_privilege('authenticated','public.admin_audit_lookup_guarded(uuid,integer)','EXECUTE') then
    raise exception 'BROKE ADMIN AUDIT: admin_audit_lookup_guarded must remain executable by authenticated';
  end if;
end $$;

rollback;

\echo '✓ 0198 internal-function execute lockdown regression test passed'
