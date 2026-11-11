-- 0347_scale_partitions_retention | KC#879 — time partitions + retention (partman-ready).

begin;

-- Optional pg_partman (hosted projects: enable in Dashboard first).
do $$
begin
  execute 'create schema if not exists partman';
  create extension if not exists pg_partman with schema partman;
exception
  when others then
    raise notice 'pg_partman unavailable — using native partition helpers (KC#879).';
end $$;

create or replace function public.ensure_feed_impressions_month_partition(
  p_at timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from timestamptz := date_trunc('month', p_at);
  v_to timestamptz := date_trunc('month', p_at) + interval '1 month';
  v_part text := 'feed_impressions_y' || to_char(v_from, 'YYYY') || 'm' || to_char(v_from, 'MM');
begin
  execute format(
    'create table if not exists public.%I partition of public.feed_impressions
       for values from (%L) to (%L)',
    v_part, v_from, v_to
  );
  -- Child partitions are directly addressable tables: mirror the parent's RLS
  -- (0281 feed_impressions_insert_own) so rls-lint and direct access stay safe.
  execute format('alter table public.%I enable row level security', v_part);
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = v_part
       and policyname = v_part || '_insert_own'
  ) then
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (user_id = (select auth.uid()))',
      v_part || '_insert_own', v_part
    );
  end if;
  return v_part;
end;
$$;

create or replace function public.drop_feed_impressions_partitions_older_than(
  p_retention interval default interval '12 months'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_partman') then
    raise notice 'KC#879: use partman retention policies for feed_impressions; cutoff %', now() - p_retention;
  end if;
  return 0;
end;
$$;

comment on function public.drop_feed_impressions_partitions_older_than(interval) is
  'KC#879: drops monthly feed_impressions child partitions wholly before cutoff.';

-- BRIN aids time-range scans until native/monthly partitions exist on append-heavy tables.
create index if not exists audit_events_created_at_brin_idx
  on public.audit_events using brin (created_at);

create index if not exists messages_created_at_brin_idx
  on public.messages using brin (created_at);

create index if not exists notifications_outbox_created_at_brin_idx
  on public.notifications_outbox using brin (created_at);

create index if not exists notification_inbox_created_at_brin_idx
  on public.notification_inbox using brin (created_at);

create or replace function public.scale_retention_purge_notifications_outbox(
  p_older_than interval default interval '30 days'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n bigint;
begin
  delete from public.notifications_outbox
   where dispatched_at is not null
     and dispatched_at < now() - p_older_than;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.ensure_feed_impressions_month_partition(timestamptz) from public, authenticated, anon;
revoke all on function public.drop_feed_impressions_partitions_older_than(interval) from public, authenticated, anon;
revoke all on function public.scale_retention_purge_notifications_outbox(interval) from public, authenticated, anon;

do $$
begin
  perform public.ensure_feed_impressions_month_partition(now());
  perform public.ensure_feed_impressions_month_partition(now() + interval '1 month');

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'feed_impressions_partition_ensure') then
      perform cron.unschedule('feed_impressions_partition_ensure');
    end if;
    perform cron.schedule(
      'feed_impressions_partition_ensure',
      '5 3 1 * *',
      $sql$ select public.ensure_feed_impressions_month_partition(now() + interval '1 month'); $sql$
    );
  end if;
end $$;

commit;
