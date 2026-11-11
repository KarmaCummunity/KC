-- 0283_feed_filter_rpcs | KC#870 — hide post, mute filters, impression logging.

create or replace function public.rpc_feed_hide_post(p_post_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_active_member((select auth.uid())) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;
  insert into public.feed_post_hides (user_id, post_id)
  values ((select auth.uid()), p_post_id)
  on conflict do nothing;
end;
$$;

grant execute on function public.rpc_feed_hide_post(uuid) to authenticated;

create or replace function public.rpc_feed_add_mute_filter(
  p_filter_kind text,
  p_filter_value text
)
returns public.feed_mute_filters
language plpgsql
security invoker
set search_path = public
as $$
declare v_row public.feed_mute_filters;
begin
  if not public.is_active_member((select auth.uid())) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;
  if p_filter_kind not in ('user', 'category', 'keyword', 'world') then
    raise exception 'invalid_filter_kind' using errcode = '22023';
  end if;
  insert into public.feed_mute_filters (user_id, filter_kind, filter_value)
  values ((select auth.uid()), p_filter_kind, trim(p_filter_value))
  on conflict (user_id, filter_kind, filter_value) do update set created_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

grant execute on function public.rpc_feed_add_mute_filter(text, text) to authenticated;

create or replace function public.rpc_feed_list_mute_filters()
returns setof public.feed_mute_filters
language sql
stable
security invoker
set search_path = public
as $$
  select * from public.feed_mute_filters
   where user_id = (select auth.uid())
   order by created_at desc;
$$;

grant execute on function public.rpc_feed_list_mute_filters() to authenticated;

create or replace function public.rpc_feed_remove_mute_filter(p_filter_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.feed_mute_filters
   where filter_id = p_filter_id and user_id = (select auth.uid());
end;
$$;

grant execute on function public.rpc_feed_remove_mute_filter(uuid) to authenticated;

create or replace function public.rpc_feed_log_impressions(p_post_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare v_uid uuid := (select auth.uid());
  v_n integer := 0;
  v_pid uuid;
begin
  if v_uid is null or p_post_ids is null then return 0; end if;
  foreach v_pid in array p_post_ids loop
    insert into public.feed_impressions (user_id, post_id) values (v_uid, v_pid);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

grant execute on function public.rpc_feed_log_impressions(uuid[]) to authenticated;
