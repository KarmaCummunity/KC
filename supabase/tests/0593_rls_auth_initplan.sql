\set ON_ERROR_STOP on
begin;

do $$
declare
  v_policy record;
  v_count integer;
begin
  for v_policy in
    select * from (values
      ('posts', 'posts_select_visible'),
      ('posts', 'posts_insert_self'),
      ('posts', 'posts_update_self'),
      ('posts', 'posts_delete_self_unlinked'),
      ('chats', 'chats_select_visible'),
      ('chats', 'chats_insert_self'),
      ('messages', 'messages_insert_user'),
      ('messages', 'messages_update_status_recipient'),
      ('listings', 'listings_select_visible'),
      ('listings', 'listings_insert_own'),
      ('listings', 'listings_update_own'),
      ('users', 'users_select_active'),
      ('users', 'users_select_self'),
      ('users', 'users_update_self'),
      ('follow_edges', 'follow_edges_insert_self'),
      ('follow_edges', 'follow_edges_delete_participants'),
      ('saved_posts', 'saved_posts_select_self'),
      ('saved_posts', 'saved_posts_insert_self_visible'),
      ('saved_posts', 'saved_posts_delete_self')
    ) as expected(tablename, policyname)
  loop
    select count(*) into v_count from pg_policies
    where schemaname = 'public' and tablename = v_policy.tablename
      and policyname = v_policy.policyname;
    if v_count <> 1 then
      raise exception 'expected policy %.% exactly once; found %', v_policy.tablename, v_policy.policyname, v_count;
    end if;

    if exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = v_policy.tablename
        and p.policyname = v_policy.policyname
        and regexp_replace(
          concat_ws(' ', p.qual, p.with_check),
          '\(\s*select\s+auth\.(uid|jwt|role)\s*\(\)(\s+as\s+\w+)?\s*\)',
          'INITPLAN_AUTH_CALL', 'gi'
        ) ~* 'auth\.(uid|jwt|role)\s*\('
    ) then
      raise exception 'policy %.% contains a bare auth call', v_policy.tablename, v_policy.policyname;
    end if;
  end loop;
end
$$;

rollback;
