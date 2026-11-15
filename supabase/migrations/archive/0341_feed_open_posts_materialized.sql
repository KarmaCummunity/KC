-- 0341_feed_open_posts_materialized | KC#899 — precomputed open feed slice + refresh state.

begin;

create table if not exists public.feed_mv_refresh_state (
  singleton_id   smallint primary key default 1 check (singleton_id = 1),
  dirty          boolean not null default true,
  last_refresh_at timestamptz,
  row_count      bigint not null default 0,
  updated_at     timestamptz not null default now()
);

insert into public.feed_mv_refresh_state (singleton_id, dirty)
values (1, true)
on conflict (singleton_id) do nothing;

alter table public.feed_mv_refresh_state enable row level security;
revoke all on public.feed_mv_refresh_state from authenticated, anon;
-- Internal bookkeeping: only service_role (which bypasses RLS anyway) reads it.
create policy feed_mv_refresh_state_service_read on public.feed_mv_refresh_state
  for select to service_role using (true);

-- The MV holds every open/closed post regardless of visibility, so it must NOT
-- live in an API-exposed schema (PostgREST serves `public` only). feed_ranked_ids
-- (security invoker) reads it joined to RLS-protected public.posts.
create schema if not exists kc_private;
revoke all on schema kc_private from public;
grant usage on schema kc_private to anon, authenticated, service_role;

create materialized view if not exists kc_private.feed_open_posts_mv as
select
  p.post_id,
  p.created_at,
  p.owner_id,
  p.type,
  p.status,
  p.visibility,
  p.category,
  p.item_condition,
  p.city,
  p.title,
  p.description,
  coalesce(ps.reaction_count, 0) as reaction_count,
  coalesce(ps.comment_count, 0) as comment_count
from public.posts p
left join public.post_stats ps on ps.post_id = p.post_id
where p.status in ('open', 'closed_delivered')
with no data;

comment on materialized view kc_private.feed_open_posts_mv is
  'KC#899: denormalized feed scan surface; refresh via refresh_feed_open_posts_mv().';

revoke all on kc_private.feed_open_posts_mv from public;
grant select on kc_private.feed_open_posts_mv to anon, authenticated, service_role;

create unique index if not exists feed_open_posts_mv_post_id_uidx
  on kc_private.feed_open_posts_mv (post_id);

create index if not exists feed_open_posts_mv_open_newest_idx
  on kc_private.feed_open_posts_mv (created_at desc, post_id desc)
  where status = 'open';

create index if not exists feed_open_posts_mv_open_type_cat_idx
  on kc_private.feed_open_posts_mv (type, category, created_at desc, post_id desc)
  where status = 'open';

commit;
