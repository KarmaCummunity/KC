-- Activity · personal timeline and community numbers (FR-STATS-003, FR-STATS-004)

-- ── Personal activity timeline ───────────────────────────────────────────────────────────
-- The caller's recent activity, newest first (FR-STATS-003: up to 30 entries). It is read
-- from the rows that already record what happened — the caller's posts and the handoffs
-- they received — instead of a second log table: a log would repeat that state, need one
-- more trigger on every post write (design §5 "Trigger budget") and its own purge on
-- deletion. The price: each post shows its history as it stands — a closure that was later
-- reopened is no longer listed, and there is no separate "reopened" entry.
--   post_created               the caller published the post
--   post_closed_delivered      … closed it as delivered
--   post_closed_no_recipient   … closed it without a recipient
--   post_expired · post_removed_admin
--   marked_as_recipient        the owner (actor) handed the post over to the caller
--   unmarked_as_recipient      the caller removed their recipient mark
-- Runs with the caller's rights: every row is one the caller may already read. A handoff
-- whose post the caller can no longer read is listed without a title.
create function public.my_activity_timeline(p_limit integer default 30)
returns table (
  kind text, post_id uuid, post_title text, actor_id uuid, actor_display_name text,
  occurred_at timestamptz, world_slug text)
language sql
stable
security invoker
set search_path = ''
as $$
  with me as (select (select auth.uid()) as id, least(greatest(coalesce(p_limit, 30), 1), 100) as n),
  entries as (
    (select 'post_created' as kind, p.id as post_id, null::uuid as actor_id, p.published_at as occurred_at
       from public.posts p, me
      where p.owner_id = me.id and p.published_at is not null
      order by p.published_at desc
      limit (select n from me))
    union all
    -- A closed, expired or removed post is locked, so its last update is the status move;
    -- a post closed without a recipient carries the exact time in its purge deadline.
    (select case p.status when 'closed_delivered' then 'post_closed_delivered'
                          when 'deleted_no_recipient' then 'post_closed_no_recipient'
                          when 'expired' then 'post_expired'
                          else 'post_removed_admin' end,
            p.id, null::uuid, coalesce(c.purge_after - interval '7 days', p.updated_at)
       from public.posts p
       cross join me
       left join public.post_closures c on c.post_id = p.id and p.status = 'deleted_no_recipient'
      where p.owner_id = me.id
        and p.status in ('closed_delivered', 'deleted_no_recipient', 'expired', 'removed_admin')
      order by p.updated_at desc
      limit (select n from me))
    union all
    (select case h.status when 'handed_over' then 'marked_as_recipient' else 'unmarked_as_recipient' end,
            h.post_id, case h.status when 'handed_over' then h.owner_id end,
            coalesce(h.handed_over_at, h.cancelled_at)
       from public.post_handoffs h, me
      where h.recipient_id = me.id
        and (h.status = 'handed_over' or (h.status = 'cancelled' and h.cancel_reason = 'unmarked'))
      order by h.created_at desc
      limit (select n from me))
  )
  select e.kind, e.post_id, p.title, e.actor_id, u.display_name, e.occurred_at, p.world_slug
    from entries e
    left join public.posts p on p.id = e.post_id
    left join public.users u on u.id = e.actor_id
   order by e.occurred_at desc, e.post_id
   limit (select n from me);
$$;
comment on function public.my_activity_timeline(integer) is
  'The caller''s recent activity (posts published and closed, handoffs received), newest first, with the world of each post (null once the post is gone).';
grant execute on function public.my_activity_timeline(integer) to authenticated;

-- ── Community numbers ────────────────────────────────────────────────────────────────────
-- Three numbers for the whole community (FR-STATS-004 AC1). Counting them is a job's work,
-- once a minute, not a reader's: every reader gets the one stored row.
create table kc_private.community_stats (
  id                   boolean primary key default true check (id),
  -- Members with an active account.
  registered_users     bigint not null default 0 check (registered_users >= 0),
  -- Open posts shown to everyone.
  open_public_posts    bigint not null default 0 check (open_public_posts >= 0),
  -- Posts closed as delivered, all time.
  delivered_posts      bigint not null default 0 check (delivered_posts >= 0),
  refreshed_at         timestamptz not null default now()
);
comment on table kc_private.community_stats is 'Community-wide counters (one row), refreshed by a scheduled job.';

alter table kc_private.community_stats enable row level security;
alter table kc_private.community_stats force row level security;

-- Recounts the three numbers. The first two are index-only counts over partial indexes
-- (users_city_idx, posts_feed_recent_idx). Run by a scheduled job.
create function kc_private.community_stats_refresh()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into kc_private.community_stats as s (id, registered_users, open_public_posts, delivered_posts)
  values (
    true,
    (select count(*) from public.users u where u.is_active),
    (select count(*) from public.posts p where p.status = 'open' and p.visibility = 'Public'),
    (select count(*) from public.posts p where p.status = 'closed_delivered'))
  on conflict (id) do update
    set registered_users = excluded.registered_users, open_public_posts = excluded.open_public_posts,
        delivered_posts = excluded.delivered_posts, refreshed_at = now();
$$;
comment on function kc_private.community_stats_refresh() is 'Recounts the community counters into their single row.';

-- The community numbers for any signed-in member: counts only, nobody is identified
-- (FR-STATS-006 AC2). Zeros with a null `refreshed_at` until the first refresh.
create function public.community_stats()
returns table (registered_users bigint, open_public_posts bigint, delivered_posts bigint, refreshed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(s.registered_users, 0), coalesce(s.open_public_posts, 0),
         coalesce(s.delivered_posts, 0), s.refreshed_at
    from (select kc_private.require_caller()) caller
    left join kc_private.community_stats s on true;
$$;
comment on function public.community_stats() is 'Community-wide counters: active members, open public posts, delivered posts.';
grant execute on function public.community_stats() to authenticated;
