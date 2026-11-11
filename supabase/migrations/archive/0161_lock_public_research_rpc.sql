-- 0161_lock_public_research_rpc | Audit C-01, H-BE-01 (TD-161)
--
-- Revoke direct PostgREST access for anon on high-risk SECURITY DEFINER RPCs.
-- Public research submissions must go through the public-research-submit Edge
-- Function (service role). Admin role probes must not be enumerable by anon.

revoke execute on function public.submit_public_research_response(
  text, int, text, text, text, jsonb, text, text, text
) from anon;

revoke execute on function public.has_admin_role(uuid, text) from anon;

comment on function public.submit_public_research_response(
  text, int, text, text, text, jsonb, text, text, text
) is
  'SECURITY DEFINER research submit. Anon EXECUTE revoked (0161); call via public-research-submit Edge Function only. FR-RESEARCH-001..003, TD-161.';

comment on function public.has_admin_role(uuid, text) is
  'Returns true iff the user holds an active grant for the given role. Anon EXECUTE revoked (0161); authenticated + RLS callers only. TD-161.';

-- Self-test: grants must not be callable by anon (mirrors 0099 / supabase/tests/0161).
do $check$
declare
  v_has_exec boolean;
begin
  select has_function_privilege(
    'anon',
    'public.submit_public_research_response(text,int,text,text,text,jsonb,text,text,text)',
    'execute'
  ) into v_has_exec;
  if v_has_exec then
    raise exception
      'migration 0161: anon still has EXECUTE on submit_public_research_response';
  end if;

  select has_function_privilege(
    'anon',
    'public.has_admin_role(uuid,text)',
    'execute'
  ) into v_has_exec;
  if v_has_exec then
    raise exception 'migration 0161: anon still has EXECUTE on has_admin_role';
  end if;
end
$check$;
