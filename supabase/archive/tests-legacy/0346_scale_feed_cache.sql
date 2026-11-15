-- supabase/tests/0346_scale_feed_cache.sql | KC#879 / #878 smoke

begin;

do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cron_refresh_feed_open_posts_mv_if_dirty'
  ) then
    raise exception 'ASSERT FAILED: cron_refresh_feed_open_posts_mv_if_dirty missing';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'feed_cache_process_queue'
  ) then
    raise exception 'ASSERT FAILED: feed_cache_process_queue missing';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'audit_events_created_at_brin_idx'
  ) then
    raise exception 'ASSERT FAILED: audit_events BRIN index missing';
  end if;

  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'messages'
  ) then
    raise exception 'ASSERT FAILED: messages still on supabase_realtime publication';
  end if;
end $$;

commit;
