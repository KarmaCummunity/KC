-- 0190_karma_recompute_and_backfill | FR-KARMA-001 — nightly drift recompute + backfill
-- Mirrors 0045 (stats recompute). karma_points is the denorm of sum(karma_ledger);
-- this reconciles drift and seeds existing users (registration + counters).

set search_path = public;

-- ── 1. Drift tables ─────────────────────────────────────────────────────────
create table if not exists public.karma_recompute_runs (
  run_id          bigserial primary key,
  run_at          timestamptz not null default now(),
  users_processed integer not null,
  drift_events    integer not null
);
create table if not exists public.karma_drift_events (
  drift_id    bigserial primary key,
  run_id      bigint not null references public.karma_recompute_runs (run_id) on delete cascade,
  detected_at timestamptz not null default now(),
  user_id     uuid not null references public.users (user_id) on delete cascade,
  old_value   integer not null,
  new_value   integer not null
);
create index if not exists karma_drift_events_run_idx on public.karma_drift_events (run_id);

alter table public.karma_recompute_runs enable row level security;
alter table public.karma_drift_events enable row level security;
drop policy if exists karma_recompute_runs_select_admin on public.karma_recompute_runs;
create policy karma_recompute_runs_select_admin on public.karma_recompute_runs
  for select using (public.is_admin(auth.uid()));
drop policy if exists karma_drift_events_select_admin on public.karma_drift_events;
create policy karma_drift_events_select_admin on public.karma_drift_events
  for select using (public.is_admin(auth.uid()));
revoke insert, update, delete on public.karma_recompute_runs from authenticated, anon;
revoke insert, update, delete on public.karma_drift_events from authenticated, anon;
revoke select on public.karma_recompute_runs from authenticated, anon;
revoke select on public.karma_drift_events from authenticated, anon;

-- ── 2. Recompute (SECURITY DEFINER) — single GROUP BY pass, not per-user subqueries
create or replace function public.karma_recompute_nightly()
returns table (users_processed integer, drift_events integer)
language plpgsql security definer set search_path = public as $$
declare v_run_id bigint; v_processed integer := 0; v_drift integer := 0;
begin
  insert into public.karma_recompute_runs (users_processed, drift_events) values (0, 0)
  returning run_id into v_run_id;

  with sums as (
    select user_id, greatest(0, sum(points_delta))::integer as v
      from public.karma_ledger group by user_id
  ),
  ins as (
    insert into public.karma_drift_events (run_id, user_id, old_value, new_value)
    select v_run_id, u.user_id, u.karma_points, coalesce(s.v, 0)
      from public.users u left join sums s on s.user_id = u.user_id
     where u.karma_points is distinct from coalesce(s.v, 0)
    returning drift_id
  )
  select count(*)::integer into v_drift from ins;

  with sums as (
    select user_id, greatest(0, sum(points_delta))::integer as v
      from public.karma_ledger group by user_id
  )
  update public.users u
     set karma_points = coalesce(s.v, 0)
    from sums s
   where u.user_id = s.user_id and u.karma_points is distinct from coalesce(s.v, 0);

  -- Defensive: users with an empty ledger but nonzero karma (should not happen).
  update public.users u set karma_points = 0
   where u.karma_points <> 0
     and not exists (select 1 from public.karma_ledger l where l.user_id = u.user_id);

  select count(*)::integer into v_processed from public.users;
  if v_drift > 0 then
    raise notice 'karma_drift_detected run_id=% drift_events=%', v_run_id, v_drift;
  end if;
  update public.karma_recompute_runs set users_processed = v_processed, drift_events = v_drift
   where run_id = v_run_id;
  return query select v_processed, v_drift;
end;
$$;
revoke all on function public.karma_recompute_nightly() from public;

-- ── 3. pg_cron schedule (04:30, after stats at 04:15) ───────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'karma_recompute_nightly') then
      perform cron.unschedule('karma_recompute_nightly');
    end if;
    perform cron.schedule('karma_recompute_nightly', '30 4 * * *',
      $sql$ select * from public.karma_recompute_nightly(); $sql$);
  else
    raise notice 'pg_cron not enabled — karma_recompute_nightly not scheduled. Enable in Supabase dashboard, then re-run.';
  end if;
end$$;

-- ── 4. One-time backfill (FR-KARMA-001) ─────────────────────────────────────
-- Seed every existing user: +1 registration + counters. One summary ledger row
-- per user (the once-index dedupes a re-run). New signups after this migration get
-- +1 via the registration trigger (0189). Guard: only backfill users with no
-- 'registration' ledger row yet (i.e. created before 0189).
insert into public.karma_ledger (user_id, event_type, points_delta, ref_type, ref_id)
select u.user_id,
       'backfill',
       1 + (u.items_given_count * 20) + (u.items_received_count * 15) + (u.followers_count * 1),
       'user',
       u.user_id::text
  from public.users u
 where not exists (
   select 1 from public.karma_ledger l
    where l.user_id = u.user_id and l.event_type = 'registration'
 )
on conflict do nothing;

-- Reconcile the denorm from the ledger for everyone.
update public.users u
   set karma_points = greatest(0, coalesce(
         (select sum(l.points_delta) from public.karma_ledger l where l.user_id = u.user_id), 0));

-- end of 0190_karma_recompute_and_backfill
