-- Platform · counter reconciliation (design §5 "Counters")
--
-- user_stats and post_stats are kept by triggers. Once a night each counter that can be
-- recomputed from rows that still exist is recomputed; a difference is written to
-- ops.counter_drift and the counter is repaired. Drift means a trigger missed a case, so
-- every row there is a bug report.
--
-- Reconciled:      user_stats  followers_count, following_count, open_posts_public,
--                              open_posts_followers_only, open_posts_only_me
--                  post_stats  reactions_count, comments_count, shares_count
-- Not reconciled:  user_stats  items_given_count, items_received_count, posts_created_total,
--                              volunteer_hours_total, karma_points — running totals whose
--                              source rows are purged (deleted posts) or owned by a ledger.
--
-- A candidate is found by one set-based comparison, then confirmed under the counter row's
-- lock: the triggers take the same lock, so a write in flight is either fully counted or
-- not seen at all, never half.

-- Writes one drift row per counter that differs between the two objects; returns how many.
create function kc_private.counter_drift_record(
  p_table text, p_subject_id uuid, p_stored jsonb, p_actual jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  insert into ops.counter_drift (counter_table, counter_name, subject_id, stored_value, actual_value)
  select p_table, a.key, p_subject_id, coalesce((p_stored ->> a.key)::bigint, 0), a.value::bigint
    from jsonb_each_text(p_actual) a
   where coalesce((p_stored ->> a.key)::bigint, 0) <> a.value::bigint;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
comment on function kc_private.counter_drift_record(text, uuid, jsonb, jsonb) is
  'Records the counters that differ between a stored and a recomputed set; returns their number.';

-- The recomputable counters of one member, from the source rows.
create function kc_private.user_stats_actual(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'followers_count', (select count(*) from public.follows f where f.followed_id = p_user_id),
    'following_count', (select count(*) from public.follows f where f.follower_id = p_user_id),
    'open_posts_public', count(*) filter (where p.visibility = 'Public'),
    'open_posts_followers_only', count(*) filter (where p.visibility = 'FollowersOnly'),
    'open_posts_only_me', count(*) filter (where p.visibility = 'OnlyMe'))
    from public.posts p
   where p.owner_id = p_user_id and p.status = 'open';
$$;

-- Recomputes the recomputable member counters; returns the number of counters repaired.
create function kc_private.user_stats_reconcile()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_stored jsonb;
  v_actual jsonb;
  v_fixed integer := 0;
  v_drifted integer;
begin
  for v_user_id in
    with followers as (select f.followed_id as user_id, count(*) as n from public.follows f group by 1),
         following as (select f.follower_id as user_id, count(*) as n from public.follows f group by 1),
         open_posts as (
           select p.owner_id as user_id,
                  count(*) filter (where p.visibility = 'Public') as n_public,
                  count(*) filter (where p.visibility = 'FollowersOnly') as n_followers,
                  count(*) filter (where p.visibility = 'OnlyMe') as n_only_me
             from public.posts p where p.status = 'open' group by 1)
    select s.user_id
      from public.user_stats s
      left join followers a on a.user_id = s.user_id
      left join following b on b.user_id = s.user_id
      left join open_posts o on o.user_id = s.user_id
     where (s.followers_count, s.following_count, s.open_posts_public,
            s.open_posts_followers_only, s.open_posts_only_me)
           is distinct from
           (coalesce(a.n, 0)::integer, coalesce(b.n, 0)::integer, coalesce(o.n_public, 0)::integer,
            coalesce(o.n_followers, 0)::integer, coalesce(o.n_only_me, 0)::integer)
  loop
    select to_jsonb(s) into v_stored from public.user_stats s where s.user_id = v_user_id for update;
    continue when v_stored is null;
    v_actual := kc_private.user_stats_actual(v_user_id);
    v_drifted := kc_private.counter_drift_record('user_stats', v_user_id, v_stored, v_actual);
    if v_drifted > 0 then
      update public.user_stats s
         set followers_count = (v_actual ->> 'followers_count')::integer,
             following_count = (v_actual ->> 'following_count')::integer,
             open_posts_public = (v_actual ->> 'open_posts_public')::integer,
             open_posts_followers_only = (v_actual ->> 'open_posts_followers_only')::integer,
             open_posts_only_me = (v_actual ->> 'open_posts_only_me')::integer
       where s.user_id = v_user_id;
      v_fixed := v_fixed + v_drifted;
    end if;
  end loop;
  return v_fixed;
end;
$$;
comment on function kc_private.user_stats_reconcile() is
  'Nightly: recomputes follower, following and open-post counters, records drift in ops.counter_drift and repairs it.';

-- The engagement counters of one post, from the source rows.
create function kc_private.post_stats_actual(p_post_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'reactions_count', (select count(*) from public.post_reactions r where r.post_id = p_post_id),
    'comments_count', (select count(*) from public.post_comments c
                        where c.post_id = p_post_id and c.status = 'active'),
    'shares_count', (select count(*) from public.post_shares s where s.post_id = p_post_id));
$$;

-- Recomputes the engagement counters of every post; a post that has engagement but no
-- counter row gets one. Returns the number of counters repaired.
create function kc_private.post_stats_reconcile()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_id uuid;
  v_stored jsonb;
  v_actual jsonb;
  v_fixed integer := 0;
  v_drifted integer;
begin
  for v_post_id in
    with actual as (
      select x.post_id, sum(x.r)::integer as r, sum(x.c)::integer as c, sum(x.s)::integer as s
        from (select pr.post_id, count(*) as r, 0 as c, 0 as s from public.post_reactions pr group by 1
              union all
              select pc.post_id, 0, count(*), 0 from public.post_comments pc where pc.status = 'active' group by 1
              union all
              select ps.post_id, 0, 0, count(*) from public.post_shares ps group by 1) x
       group by x.post_id)
    select coalesce(s.post_id, a.post_id)
      from public.post_stats s
      full join actual a on a.post_id = s.post_id
     where (coalesce(s.reactions_count, 0), coalesce(s.comments_count, 0), coalesce(s.shares_count, 0))
           is distinct from (coalesce(a.r, 0), coalesce(a.c, 0), coalesce(a.s, 0))
  loop
    -- The post row is the lock when no counter row exists yet.
    perform 1 from public.posts p where p.id = v_post_id for share;
    continue when not found;
    insert into public.post_stats (post_id) values (v_post_id) on conflict (post_id) do nothing;
    select to_jsonb(s) into v_stored from public.post_stats s where s.post_id = v_post_id for update;
    v_actual := kc_private.post_stats_actual(v_post_id);
    v_drifted := kc_private.counter_drift_record('post_stats', v_post_id, v_stored, v_actual);
    if v_drifted > 0 then
      update public.post_stats s
         set reactions_count = (v_actual ->> 'reactions_count')::integer,
             comments_count = (v_actual ->> 'comments_count')::integer,
             shares_count = (v_actual ->> 'shares_count')::integer
       where s.post_id = v_post_id;
      v_fixed := v_fixed + v_drifted;
    end if;
  end loop;
  return v_fixed;
end;
$$;
comment on function kc_private.post_stats_reconcile() is
  'Nightly: recomputes reaction, comment and share counters, records drift in ops.counter_drift and repairs it.';
