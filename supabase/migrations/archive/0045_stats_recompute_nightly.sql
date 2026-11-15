-- 0045_stats_recompute_nightly | FR-STATS-005 — nightly counter recompute + drift log + pg_cron
--
-- Scans users with post/recipient activity in the last 7 days, recomputes the
-- three personal counters from ground truth (same semantics as 0018 backfill),
-- reconciles mismatches, records drift rows, and raises NOTICE for observability.
--
-- Requires pg_cron enabled (Supabase dashboard) — same operator note as 0016.

set search_path = public;

-- ── 1. Drift + run tables ────────────────────────────────────────────────────
create table if not exists public.stats_recompute_runs (
  run_id            bigserial primary key,
  run_at            timestamptz not null default now(),
  users_processed   integer not null,
  drift_events      integer not null
);

create table if not exists public.stats_drift_events (
  drift_id          bigserial primary key,
  run_id            bigint not null references public.stats_recompute_runs (run_id) on delete cascade,
  detected_at       timestamptz not null default now(),
  user_id           uuid not null references public.users (user_id) on delete cascade,
  column_name       text not null,
  old_value         integer not null,
  new_value         integer not null
);

create index if not exists stats_drift_events_run_idx on public.stats_drift_events (run_id);
create index if not exists stats_drift_events_detected_idx on public.stats_drift_events (detected_at desc);

alter table public.stats_recompute_runs enable row level security;
alter table public.stats_drift_events enable row level security;

create policy stats_recompute_runs_select_admin on public.stats_recompute_runs
  for select using (public.is_admin(auth.uid()));

create policy stats_drift_events_select_admin on public.stats_drift_events
  for select using (public.is_admin(auth.uid()));

revoke insert, update, delete on public.stats_recompute_runs from authenticated, anon;
revoke insert, update, delete on public.stats_drift_events from authenticated, anon;
revoke select on public.stats_recompute_runs from authenticated, anon;
revoke select on public.stats_drift_events from authenticated, anon;

-- ── 2. Nightly recompute (SECURITY DEFINER — not granted to app roles) ──────
create or replace function public.stats_recompute_personal_counters_nightly()
returns table (users_processed integer, drift_events integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id        bigint;
  v_processed     integer := 0;
  v_drift         integer := 0;
  v_cutoff        timestamptz := now() - interval '7 days';
begin
  insert into public.stats_recompute_runs (users_processed, drift_events)
  values (0, 0)
  returning run_id into v_run_id;

  with cand as (
    select distinct x.uid as user_id
    from (
      select p.owner_id as uid
        from public.posts p
       where p.updated_at >= v_cutoff
          or p.created_at >= v_cutoff
      union all
      select r.recipient_user_id as uid
        from public.recipients r
        join public.posts p on p.post_id = r.post_id
       where p.updated_at >= v_cutoff
          or r.marked_at >= v_cutoff
    ) x
    where x.uid is not null
  )
  select count(*)::integer into v_processed from cand;

  with cand as (
    select distinct x.uid as user_id
    from (
      select p.owner_id as uid
        from public.posts p
       where p.updated_at >= v_cutoff
          or p.created_at >= v_cutoff
      union all
      select r.recipient_user_id as uid
        from public.recipients r
        join public.posts p on p.post_id = r.post_id
       where p.updated_at >= v_cutoff
          or r.marked_at >= v_cutoff
    ) x
    where x.uid is not null
  ),
  truth as (
    select
      c.user_id,
      (
        select count(*)::integer
          from public.posts p
         where p.owner_id = c.user_id
           and p.status = 'open'
      ) as active_internal,
      (
        select count(*)::integer
          from public.posts p
         where p.owner_id = c.user_id
           and p.status in ('closed_delivered', 'deleted_no_recipient')
           and p.type = 'Give'
      ) + (
        select count(*)::integer
          from public.recipients r
          join public.posts p on p.post_id = r.post_id
         where r.recipient_user_id = c.user_id
           and p.type = 'Request'
      ) as items_given,
      (
        select count(*)::integer
          from public.posts p
         where p.owner_id = c.user_id
           and p.status in ('closed_delivered', 'deleted_no_recipient')
           and p.type = 'Request'
      ) + (
        select count(*)::integer
          from public.recipients r
          join public.posts p on p.post_id = r.post_id
         where r.recipient_user_id = c.user_id
           and p.type = 'Give'
      ) as items_received
    from cand c
  ),
  drift_rows as (
    select v_run_id as run_id,
           t.user_id,
           'items_given_count'::text as column_name,
           u.items_given_count as old_value,
           t.items_given as new_value
      from truth t
      join public.users u on u.user_id = t.user_id
     where t.items_given is distinct from u.items_given_count
    union all
    select v_run_id,
           t.user_id,
           'items_received_count',
           u.items_received_count,
           t.items_received
      from truth t
      join public.users u on u.user_id = t.user_id
     where t.items_received is distinct from u.items_received_count
    union all
    select v_run_id,
           t.user_id,
           'active_posts_count_internal',
           u.active_posts_count_internal,
           t.active_internal
      from truth t
      join public.users u on u.user_id = t.user_id
     where t.active_internal is distinct from u.active_posts_count_internal
  ),
  ins as (
    insert into public.stats_drift_events (run_id, user_id, column_name, old_value, new_value)
    select d.run_id, d.user_id, d.column_name, d.old_value, d.new_value
      from drift_rows d
    returning drift_id
  )
  select count(*)::integer into v_drift from ins;

  with cand as (
    select distinct x.uid as user_id
    from (
      select p.owner_id as uid
        from public.posts p
       where p.updated_at >= v_cutoff
          or p.created_at >= v_cutoff
      union all
      select r.recipient_user_id as uid
        from public.recipients r
        join public.posts p on p.post_id = r.post_id
       where p.updated_at >= v_cutoff
          or r.marked_at >= v_cutoff
    ) x
    where x.uid is not null
  ),
  truth as (
    select
      c.user_id,
      (
        select count(*)::integer
          from public.posts p
         where p.owner_id = c.user_id
           and p.status = 'open'
      ) as active_internal,
      (
        select count(*)::integer
          from public.posts p
         where p.owner_id = c.user_id
           and p.status in ('closed_delivered', 'deleted_no_recipient')
           and p.type = 'Give'
      ) + (
        select count(*)::integer
          from public.recipients r
          join public.posts p on p.post_id = r.post_id
         where r.recipient_user_id = c.user_id
           and p.type = 'Request'
      ) as items_given,
      (
        select count(*)::integer
          from public.posts p
         where p.owner_id = c.user_id
           and p.status in ('closed_delivered', 'deleted_no_recipient')
           and p.type = 'Request'
      ) + (
        select count(*)::integer
          from public.recipients r
          join public.posts p on p.post_id = r.post_id
         where r.recipient_user_id = c.user_id
           and p.type = 'Give'
      ) as items_received
    from cand c
  )
  update public.users u
     set items_given_count = t.items_given,
         items_received_count = t.items_received,
         active_posts_count_internal = t.active_internal
    from truth t
   where u.user_id = t.user_id;

  if v_drift > 0 then
    raise notice 'stats_drift_detected run_id=% drift_events=%', v_run_id, v_drift;
  end if;

  update public.stats_recompute_runs
     set users_processed = v_processed,
         drift_events = v_drift
   where run_id = v_run_id;

  raise notice 'stats_recompute_personal_counters_nightly: run_id=% users_processed=% drift_events=%',
    v_run_id, v_processed, v_drift;

  return query select v_processed, v_drift;
end;
$$;

revoke all on function public.stats_recompute_personal_counters_nightly() from public;

-- ── 3. pg_cron schedule ─────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'stats_recompute_nightly') then
      perform cron.unschedule('stats_recompute_nightly');
    end if;
    perform cron.schedule(
      'stats_recompute_nightly',
      '15 4 * * *',
      $sql$ select * from public.stats_recompute_personal_counters_nightly(); $sql$
    );
  else
    raise notice
      'pg_cron extension not enabled — stats_recompute_nightly not scheduled. Enable in Supabase dashboard, then re-run this migration.';
  end if;
end$$;

-- end 0045_stats_recompute_nightly
