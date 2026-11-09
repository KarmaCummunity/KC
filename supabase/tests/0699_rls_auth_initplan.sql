-- 0699 | RLS auth initplan: no hot-table policy calls auth.uid() once per row.
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_table   text;
  v_count   integer;
  v_bare    text;
begin
  -- Every hot table still has policies (the rewrite must never drop one).
  foreach v_table in array array['posts', 'chats', 'messages', 'users', 'follow_edges', 'saved_posts']
  loop
    select count(*) into v_count from pg_policies
    where schemaname = 'public' and tablename = v_table;
    if v_count = 0 then
      raise exception 'table public.% has no RLS policies', v_table;
    end if;
  end loop;

  -- No policy on a hot table keeps a bare auth.uid() call.
  select string_agg(tablename || '.' || policyname, ', ') into v_bare
  from pg_policies
  where schemaname = 'public'
    and tablename in ('posts', 'chats', 'messages', 'users', 'follow_edges', 'saved_posts')
    and concat_ws(' ', qual, with_check) ~* '(?<!select )auth\.uid\(\)(?! as uid)';
  if v_bare is not null then
    raise exception 'policies with a bare auth.uid(): %', v_bare;
  end if;
end
$$;

rollback;
