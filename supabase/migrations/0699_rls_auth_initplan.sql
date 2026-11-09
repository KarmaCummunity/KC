-- 0699_rls_auth_initplan | Evaluate auth.uid() once per query in the hot-table RLS policies.
-- Supersedes the closed PR #1546 (its policy definitions were a stale snapshot).
--
-- A bare `auth.uid()` inside a policy is re-evaluated for every row; `(select auth.uid())`
-- is planned as an initplan and evaluated once per query (advisor `auth_rls_initplan`).
-- This migration rewrites each affected policy from its CURRENT live definition via
-- ALTER POLICY, so roles and command are kept and no later policy change is reverted.
-- Policy semantics are unchanged.
do $$
declare
  -- Tables whose policies are on the feed / chat / profile hot paths.
  c_hot_tables constant text[] :=
    array['posts', 'chats', 'messages', 'users', 'follow_edges', 'saved_posts'];
  -- A call that is NOT already the deparsed initplan form `( SELECT auth.uid() AS uid)`.
  c_bare_call constant text := '(?<!select )auth\.uid\(\)(?! as uid)';
  v_policy record;
  v_sql    text;
begin
  for v_policy in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and tablename = any (c_hot_tables)
      and concat_ws(' ', qual, with_check) ~* c_bare_call
  loop
    v_sql := format('alter policy %I on public.%I', v_policy.policyname, v_policy.tablename);
    if v_policy.qual is not null then
      v_sql := v_sql || ' using ('
        || regexp_replace(v_policy.qual, c_bare_call, '(select auth.uid())', 'gi') || ')';
    end if;
    if v_policy.with_check is not null then
      v_sql := v_sql || ' with check ('
        || regexp_replace(v_policy.with_check, c_bare_call, '(select auth.uid())', 'gi') || ')';
    end if;
    execute v_sql;
  end loop;
end
$$;
