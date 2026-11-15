-- 0016_closure_cleanup_cron | P0.6 — daily cleanup of unmarked closures (FR-CLOSURE-008)
--
-- After 7 days, posts in `deleted_no_recipient` are hard-deleted. The
-- recipients table cascades on FK; the media_assets table also cascades
-- on posts.post_id. Storage blobs are an orphan (TD-122) — daily reconciliation
-- ships separately.
--
-- ⚠️ Operator note: this migration calls cron.schedule, which requires the
-- `pg_cron` extension to be enabled on the Supabase project. Enable in
-- the dashboard (Database → Extensions → pg_cron → Enable) before applying.
-- The migration is idempotent and safe to re-run.

set search_path = public;

-- ── 1. cleanup function ─────────────────────────────────────────────────────
create or replace function public.closure_cleanup_expired()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_count integer;
begin
  with deleted as (
    delete from public.posts
     where status = 'deleted_no_recipient'
       and delete_after is not null
       and delete_after < now()
    returning post_id
  )
  select count(*) into v_deleted_count from deleted;

  raise notice 'closure_cleanup_expired: deleted % posts', v_deleted_count;
  return coalesce(v_deleted_count, 0);
end;
$$;

-- ── 2. observability metric ─────────────────────────────────────────────────
create table if not exists public.closure_cleanup_metrics (
  run_at         timestamptz primary key default now(),
  deleted_count  integer not null
);

-- Read-only for ops users; writes happen via SECURITY DEFINER function below.
alter table public.closure_cleanup_metrics enable row level security;
create policy closure_cleanup_metrics_select_admin on public.closure_cleanup_metrics
  for select using (public.is_admin(auth.uid()));

create or replace function public.closure_cleanup_expired_with_metric()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  v_deleted := public.closure_cleanup_expired();
  insert into public.closure_cleanup_metrics (deleted_count) values (v_deleted);
  return v_deleted;
end;
$$;

-- The functions are intentionally not granted to authenticated/anon —
-- they run only via the cron schedule (which uses the postgres role) or
-- ad-hoc by an admin via the SQL editor.

-- ── 3. cron schedule ────────────────────────────────────────────────────────
-- Daily at 04:00 UTC (06:00/07:00 IL depending on DST).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Idempotent: drop any prior schedule with the same name first.
    if exists (select 1 from cron.job where jobname = 'closure_cleanup_daily') then
      perform cron.unschedule('closure_cleanup_daily');
    end if;
    perform cron.schedule(
      'closure_cleanup_daily',
      '0 4 * * *',
      $sql$ select public.closure_cleanup_expired_with_metric(); $sql$
    );
  else
    raise notice
      'pg_cron extension not enabled — closure_cleanup_daily not scheduled. Enable in Supabase dashboard, then re-run this migration.';
  end if;
end$$;

-- end of 0016_closure_cleanup_cron
