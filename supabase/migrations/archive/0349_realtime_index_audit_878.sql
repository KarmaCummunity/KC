-- 0349_realtime_index_audit_878 | KC#878 — drop WAL fan-out tables, RLS/index audit.

begin;

-- High fan-out chat messages use Broadcast (0259); remove postgres_changes publication.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'messages'
    ) then
      execute 'alter publication supabase_realtime drop table public.messages';
    end if;
  end if;
end $$;

-- Policy-column indexes (RLS / EXISTS subqueries).
create index if not exists blocks_blocker_blocked_idx
  on public.blocks (blocker_id, blocked_id);

create index if not exists blocks_blocked_blocker_idx
  on public.blocks (blocked_id, blocker_id);

create index if not exists reporter_hides_reporter_target_idx
  on public.reporter_hides (reporter_id, target_type, target_id);

create index if not exists follow_edges_follower_followed_idx
  on public.follow_edges (follower_id, followed_id);

create index if not exists feed_mute_filters_user_kind_idx
  on public.feed_mute_filters (user_id, filter_kind, filter_value);

-- Initplan auth.uid() on feed filter policies (0281).
drop policy if exists feed_post_hides_own on public.feed_post_hides;
create policy feed_post_hides_own on public.feed_post_hides
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists feed_mute_filters_own on public.feed_mute_filters;
create policy feed_mute_filters_own on public.feed_mute_filters
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists feed_impressions_insert_own on public.feed_impressions;
create policy feed_impressions_insert_own on public.feed_impressions
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create table if not exists public.social_rpc_explain_snapshots (
  snapshot_id   uuid primary key default gen_random_uuid(),
  rpc_name      text not null,
  captured_at   timestamptz not null default now(),
  elapsed_ms    double precision,
  plan_text     text not null,
  notes         text
);

comment on table public.social_rpc_explain_snapshots is
  'KC#878: optional dev captures from social_rpc_explain_analyze.sql (not CI-seeded).';

alter table public.social_rpc_explain_snapshots enable row level security;
revoke all on public.social_rpc_explain_snapshots from authenticated, anon;
create policy social_rpc_explain_snapshots_service_read on public.social_rpc_explain_snapshots
  for select to service_role using (true);

create or replace function public.social_rpc_capture_explain(
  p_rpc_name text,
  p_plan_text text,
  p_elapsed_ms double precision default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.social_rpc_explain_snapshots (rpc_name, plan_text, elapsed_ms, notes)
  values (p_rpc_name, p_plan_text, p_elapsed_ms, p_notes)
  returning snapshot_id into v_id;
  return v_id;
end;
$$;

revoke all on function public.social_rpc_capture_explain(text, text, double precision, text)
  from public, authenticated, anon;
grant execute on function public.social_rpc_capture_explain(text, text, double precision, text)
  to service_role;

commit;
