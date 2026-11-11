-- Social · post_stats (engagement counters of a post)
--
-- One row per post that has ever been reacted to, commented on or shared; a post without a
-- row has all counters at zero. Counters live apart from `posts` so that a reaction never
-- rewrites the post row, and no trigger is added to `posts` (design §5 trigger budget).
-- Maintained by statement-level triggers on the engagement tables; a nightly job recomputes
-- them and records any drift.

create table public.post_stats (
  post_id         uuid primary key references public.posts (id) on delete cascade,
  reactions_count integer not null default 0 check (reactions_count >= 0),
  -- Active comments, replies included.
  comments_count  integer not null default 0 check (comments_count >= 0),
  shares_count    integer not null default 0 check (shares_count >= 0),
  updated_at      timestamptz not null default now()
);
comment on table public.post_stats is 'Engagement counters per post, maintained by triggers and reconciled nightly.';

create trigger post_stats_set_updated_at
  before update on public.post_stats
  for each row execute function kc_private.set_updated_at();

alter table public.post_stats enable row level security;
alter table public.post_stats force row level security;

-- Counters are visible exactly when the post is: the subquery runs under the caller's own
-- access to `posts`.
create policy post_stats_select_visible_post on public.post_stats
  for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_stats.post_id));

grant select on public.post_stats to authenticated;

-- Adds (p_sign = 1) or subtracts (p_sign = -1) one unit of a counter for every element of
-- p_post_ids; a post listed n times moves by n. Called once per statement by the engagement
-- triggers. Adding creates the row on first use. Subtracting only updates: when the post
-- itself is being removed its counter row is already gone and nothing is written, and a
-- counter never drops below zero. Posts are touched in id order so two statements cannot
-- deadlock on each other.
create function kc_private.post_stats_add(p_counter text, p_sign integer, p_post_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_sign > 0 then
    insert into public.post_stats as s (post_id, reactions_count, comments_count, shares_count)
    select d.post_id,
           d.n * (p_counter = 'reactions')::integer,
           d.n * (p_counter = 'comments')::integer,
           d.n * (p_counter = 'shares')::integer
      from (select u.post_id, count(*)::integer as n
              from unnest(p_post_ids) as u (post_id)
             group by u.post_id
             order by u.post_id) d
    on conflict (post_id) do update
      set reactions_count = s.reactions_count + excluded.reactions_count,
          comments_count = s.comments_count + excluded.comments_count,
          shares_count = s.shares_count + excluded.shares_count;
    return;
  end if;

  update public.post_stats s
     set reactions_count = greatest(s.reactions_count - d.n * (p_counter = 'reactions')::integer, 0),
         comments_count = greatest(s.comments_count - d.n * (p_counter = 'comments')::integer, 0),
         shares_count = greatest(s.shares_count - d.n * (p_counter = 'shares')::integer, 0)
    from (select u.post_id, count(*)::integer as n
            from unnest(p_post_ids) as u (post_id)
           group by u.post_id
           order by u.post_id) d
   where s.post_id = d.post_id;
end;
$$;
comment on function kc_private.post_stats_add(text, integer, uuid[]) is
  'Moves one engagement counter of the listed posts up or down; used by the engagement triggers.';

-- Records an engagement notification for the notifications module to deliver. Nothing is
-- recorded when the recipient is the actor, no longer exists, or is in a blocked pair with
-- the actor. `group_key` lets the consumer fold events of one kind on one post within the
-- same hour into a single notification (S10).
create function kc_private.notify_engagement(
  p_kind text,
  p_recipient_id uuid,
  p_actor_id uuid,
  p_post_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_recipient_id is null or p_recipient_id = p_actor_id
     or kc_access.is_blocked_between(p_recipient_id, p_actor_id) then
    return;
  end if;
  perform kc_private.outbox_enqueue('notification', jsonb_build_object(
    'kind', p_kind,
    'recipient_id', p_recipient_id,
    'actor_id', p_actor_id,
    'entity', jsonb_build_object('type', p_entity_type, 'id', p_entity_id),
    'data', jsonb_build_object(
      'post_id', p_post_id,
      'group_key', p_kind || ':' || p_post_id || ':' || to_char(now() at time zone 'UTC', 'YYYYMMDDHH24'))));
end;
$$;
comment on function kc_private.notify_engagement(text, uuid, uuid, uuid, text, uuid) is
  'Enqueues one engagement notification event, skipping self-notifications and blocked pairs.';
