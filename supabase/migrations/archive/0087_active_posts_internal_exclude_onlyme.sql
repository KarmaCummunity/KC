-- 0087_active_posts_internal_exclude_onlyme.sql
-- FR-PROFILE-013 AC1, FR-STATS-002 AC3: active_posts_count_internal excludes OnlyMe open posts.
-- FR-POST-007 unchanged: max-open limit still counts all open posts including OnlyMe.

set search_path = public;

-- ── 1. posts_after_change_counters — OnlyMe open posts skip internal counter ──
create or replace function public.posts_after_change_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_open  boolean;
  v_now_open  boolean;
  v_owner     uuid;
begin
  if tg_op = 'INSERT' then
    update public.users
       set posts_created_total = posts_created_total + 1
     where user_id = new.owner_id;

    if new.status = 'open' then
      update public.users
         set active_posts_count_internal = active_posts_count_internal
               + case when new.visibility <> 'OnlyMe' then 1 else 0 end,
             active_posts_count_public_open = active_posts_count_public_open
               + case when new.visibility = 'Public' then 1 else 0 end,
             active_posts_count_followers_only_open = active_posts_count_followers_only_open
               + case when new.visibility = 'FollowersOnly' then 1 else 0 end
       where user_id = new.owner_id;
    elsif new.status in ('closed_delivered', 'deleted_no_recipient') then
      if new.type = 'Give' then
        update public.users set items_given_count = items_given_count + 1
         where user_id = new.owner_id;
      else
        update public.users set items_received_count = items_received_count + 1
         where user_id = new.owner_id;
      end if;
    end if;
    return null;
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'open' then
      update public.users
         set active_posts_count_internal = case
               when old.visibility <> 'OnlyMe'
               then public.stats_safe_dec(active_posts_count_internal)
               else active_posts_count_internal
             end,
             active_posts_count_public_open = case
               when old.visibility = 'Public'
               then public.stats_safe_dec(active_posts_count_public_open)
               else active_posts_count_public_open
             end,
             active_posts_count_followers_only_open = case
               when old.visibility = 'FollowersOnly'
               then public.stats_safe_dec(active_posts_count_followers_only_open)
               else active_posts_count_followers_only_open
             end
       where user_id = old.owner_id;
    end if;
    return null;
  end if;

  v_owner    := new.owner_id;
  v_was_open := old.status = 'open';
  v_now_open := new.status = 'open';

  if old.status is distinct from new.status then
    if v_was_open and not v_now_open then
      update public.users
         set active_posts_count_internal = case
               when old.visibility <> 'OnlyMe'
               then public.stats_safe_dec(active_posts_count_internal)
               else active_posts_count_internal
             end,
             active_posts_count_public_open = case
               when old.visibility = 'Public'
               then public.stats_safe_dec(active_posts_count_public_open)
               else active_posts_count_public_open
             end,
             active_posts_count_followers_only_open = case
               when old.visibility = 'FollowersOnly'
               then public.stats_safe_dec(active_posts_count_followers_only_open)
               else active_posts_count_followers_only_open
             end
       where user_id = v_owner;
    elsif v_now_open and not v_was_open then
      update public.users
         set active_posts_count_internal = active_posts_count_internal
               + case when new.visibility <> 'OnlyMe' then 1 else 0 end,
             active_posts_count_public_open = active_posts_count_public_open
               + case when new.visibility = 'Public' then 1 else 0 end,
             active_posts_count_followers_only_open = active_posts_count_followers_only_open
               + case when new.visibility = 'FollowersOnly' then 1 else 0 end
       where user_id = v_owner;
    end if;

    if v_was_open and new.status in ('closed_delivered', 'deleted_no_recipient') then
      if new.type = 'Give' then
        update public.users set items_given_count = items_given_count + 1
         where user_id = v_owner;
      else
        update public.users set items_received_count = items_received_count + 1
         where user_id = v_owner;
      end if;
    elsif old.status in ('closed_delivered', 'deleted_no_recipient') and v_now_open then
      if old.type = 'Give' then
        update public.users
           set items_given_count = public.stats_safe_dec(items_given_count)
         where user_id = v_owner;
      else
        update public.users
           set items_received_count = public.stats_safe_dec(items_received_count)
         where user_id = v_owner;
      end if;
    end if;
  end if;

  if v_was_open and v_now_open and old.visibility is distinct from new.visibility then
    if old.visibility <> 'OnlyMe' and new.visibility = 'OnlyMe' then
      update public.users
         set active_posts_count_internal = public.stats_safe_dec(active_posts_count_internal)
       where user_id = v_owner;
    elsif old.visibility = 'OnlyMe' and new.visibility <> 'OnlyMe' then
      update public.users
         set active_posts_count_internal = active_posts_count_internal + 1
       where user_id = v_owner;
    end if;

    if old.visibility = 'Public' then
      update public.users
         set active_posts_count_public_open = public.stats_safe_dec(active_posts_count_public_open)
       where user_id = v_owner;
    elsif old.visibility = 'FollowersOnly' then
      update public.users
         set active_posts_count_followers_only_open = public.stats_safe_dec(active_posts_count_followers_only_open)
       where user_id = v_owner;
    end if;

    if new.visibility = 'Public' then
      update public.users
         set active_posts_count_public_open = active_posts_count_public_open + 1
       where user_id = v_owner;
    elsif new.visibility = 'FollowersOnly' then
      update public.users
         set active_posts_count_followers_only_open = active_posts_count_followers_only_open + 1
       where user_id = v_owner;
    end if;
  end if;

  return null;
end;
$$;

-- ── 2. Nightly recompute truth: exclude OnlyMe from active_internal ───────────
create or replace function public.stats_recompute_personal_counters_nightly()
returns table (users_processed integer, drift_events integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id     uuid := gen_random_uuid();
  v_cutoff     timestamptz := now() - interval '48 hours';
  v_processed  integer := 0;
  v_drift      integer := 0;
begin
  insert into public.stats_recompute_runs (run_id, started_at)
  values (v_run_id, now());

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
           and p.visibility <> 'OnlyMe'
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
           and p.visibility <> 'OnlyMe'
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

-- ── 3. Backfill denorm from ground truth ─────────────────────────────────────
update public.users u
   set active_posts_count_internal = coalesce((
         select count(*)::integer
           from public.posts p
          where p.owner_id = u.user_id
            and p.status = 'open'
            and p.visibility <> 'OnlyMe'
       ), 0);

comment on function public.active_posts_count_for_viewer(uuid, uuid) is
  'FR-PROFILE-013: self viewer → active_posts_count_internal (open, visibility <> OnlyMe); other → public_open + followers_only when approved follower.';
