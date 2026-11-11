-- 0342_feed_mv_refresh | KC#899 — refresh strategy + dirty marking on post/stats changes.

begin;

create or replace function public.mark_feed_open_posts_mv_dirty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.feed_mv_refresh_state
     set dirty = true, updated_at = now()
   where singleton_id = 1;
  return null;
end;
$$;

drop trigger if exists posts_mark_feed_mv_dirty on public.posts;
create trigger posts_mark_feed_mv_dirty
  after insert or update of status, visibility, type, category, item_condition, city, title, description
  or delete on public.posts
  for each statement
  execute function public.mark_feed_open_posts_mv_dirty();

drop trigger if exists post_stats_mark_feed_mv_dirty on public.post_stats;
create trigger post_stats_mark_feed_mv_dirty
  after insert or update of reaction_count, comment_count or delete on public.post_stats
  for each statement
  execute function public.mark_feed_open_posts_mv_dirty();

create or replace function public.refresh_feed_open_posts_mv(
  p_concurrent boolean default true
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
begin
  if p_concurrent then
    refresh materialized view concurrently kc_private.feed_open_posts_mv;
  else
    refresh materialized view kc_private.feed_open_posts_mv;
  end if;

  select count(*) into v_count from kc_private.feed_open_posts_mv;

  update public.feed_mv_refresh_state
     set dirty = false,
         last_refresh_at = now(),
         row_count = v_count,
         updated_at = now()
   where singleton_id = 1;

  return v_count;
end;
$$;

comment on function public.refresh_feed_open_posts_mv(boolean) is
  'KC#899: full refresh; call from cron/worker when dirty or on schedule. First refresh must use p_concurrent=false.';

grant execute on function public.refresh_feed_open_posts_mv(boolean) to service_role;

-- Initial populate (non-concurrent required when MV was created WITH NO DATA).
select public.refresh_feed_open_posts_mv(false);

commit;
