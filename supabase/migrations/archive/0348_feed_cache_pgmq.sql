-- 0348_feed_cache_pgmq | KC#879 — per-user feed cache worker via pgmq.

begin;

create extension if not exists pgmq;

do $$
begin
  perform pgmq.create('feed_cache_refresh');
exception
  when duplicate_object then null;
  when others then
    raise notice 'pgmq queue feed_cache_refresh not created: %', sqlerrm;
end $$;

create table if not exists public.user_feed_cache (
  user_id       uuid primary key references public.users(user_id) on delete cascade,
  post_ids      uuid[] not null default '{}'::uuid[],
  refreshed_at  timestamptz not null default now()
);

comment on table public.user_feed_cache is
  'KC#879: precomputed newest-feed post_id page per user; filled by pgmq worker.';

alter table public.user_feed_cache enable row level security;

create policy user_feed_cache_select_self on public.user_feed_cache
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on public.user_feed_cache from authenticated, anon;

create or replace function public.feed_cache_enqueue(p_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg_id bigint;
begin
  if p_user_id is null then
    raise exception 'user_id_required' using errcode = '22023';
  end if;
  select pgmq.send(
    'feed_cache_refresh',
    jsonb_build_object('user_id', p_user_id)
  ) into v_msg_id;
  return v_msg_id;
end;
$$;

create or replace function public.feed_cache_refresh_user(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_n int;
begin
  select array_agg(x.post_id)
    into v_ids
    from (
      select fr.post_id
        from public.feed_ranked_ids(
          p_user_id, null, null, null, 'open', null, null,
          'newest', null, 30, null, null, null, null, false, null
        ) fr
       limit 30
    ) x;

  v_n := coalesce(array_length(v_ids, 1), 0);

  insert into public.user_feed_cache (user_id, post_ids, refreshed_at)
  values (p_user_id, coalesce(v_ids, '{}'::uuid[]), now())
  on conflict (user_id) do update
    set post_ids = excluded.post_ids,
        refreshed_at = excluded.refreshed_at;

  return v_n;
end;
$$;

create or replace function public.feed_cache_process_queue(p_batch int default 25)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_uid uuid;
  v_done int := 0;
  v_lim int := greatest(coalesce(p_batch, 25), 1);
begin
  for r in
    select msg_id, message
      from pgmq.read('feed_cache_refresh', 30, v_lim)
  loop
    v_uid := (r.message->>'user_id')::uuid;
    if v_uid is not null then
      perform public.feed_cache_refresh_user(v_uid);
    end if;
    perform pgmq.delete('feed_cache_refresh', r.msg_id);
    v_done := v_done + 1;
  end loop;
  return v_done;
end;
$$;

create or replace function public.feed_cache_enqueue_active_users(p_limit int default 500)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  u record;
  v_n int := 0;
begin
  for u in
    select user_id from public.users
     where account_status = 'active'
     limit greatest(coalesce(p_limit, 500), 1)
  loop
    perform public.feed_cache_enqueue(u.user_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.cron_feed_cache_worker()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dirty boolean;
  v_processed int;
begin
  select dirty into v_dirty from public.feed_mv_refresh_state where singleton_id = 1;
  if coalesce(v_dirty, false) is false then
    perform public.feed_cache_enqueue_active_users(100);
  end if;
  v_processed := public.feed_cache_process_queue(50);
  return v_processed;
end;
$$;

comment on function public.cron_feed_cache_worker() is
  'KC#879: drain pgmq feed cache; enqueue sample active users when MV is fresh.';

revoke all on function public.feed_cache_enqueue(uuid) from public, authenticated, anon;
revoke all on function public.feed_cache_refresh_user(uuid) from public, authenticated, anon;
revoke all on function public.feed_cache_process_queue(integer) from public, authenticated, anon;
revoke all on function public.feed_cache_enqueue_active_users(integer) from public, authenticated, anon;
revoke all on function public.cron_feed_cache_worker() from public, authenticated, anon;

grant execute on function public.feed_cache_enqueue(uuid) to service_role;
grant execute on function public.feed_cache_refresh_user(uuid) to service_role;
grant execute on function public.feed_cache_process_queue(integer) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'feed_cache_worker') then
      perform cron.unschedule('feed_cache_worker');
    end if;
    perform cron.schedule(
      'feed_cache_worker',
      '*/5 * * * *',
      $sql$ select public.cron_feed_cache_worker(); $sql$
    );
  end if;
end $$;

commit;
