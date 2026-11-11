-- 0250_post_engagement_schema | KC#867 — post reactions, comments, shares + post_stats counters.
-- Epic KC#884 / social at scale. Denormalized counters; RLS via is_post_visible_to + blocks.

-- ── 1. post_stats (1:1 with posts) ───────────────────────────────────────────

create table if not exists public.post_stats (
  post_id          uuid primary key references public.posts(post_id) on delete cascade,
  reaction_count   integer not null default 0 check (reaction_count >= 0),
  comment_count    integer not null default 0 check (comment_count >= 0),
  share_count      integer not null default 0 check (share_count >= 0),
  updated_at       timestamptz not null default now()
);

comment on table public.post_stats is
  'Denormalized engagement counters per post (KC#867). Maintained by triggers — no count(*) on hot paths.';

create index if not exists post_stats_updated_at_idx
  on public.post_stats (updated_at desc);

-- ── 2. post_reactions ────────────────────────────────────────────────────────

create table if not exists public.post_reactions (
  reaction_id    uuid primary key default gen_random_uuid(),
  post_id        uuid not null references public.posts(post_id) on delete cascade,
  user_id        uuid not null references public.users(user_id) on delete cascade,
  reaction_type  text not null check (reaction_type in ('like', 'support', 'thanks')),
  created_at     timestamptz not null default now(),
  unique (post_id, user_id)
);

create index if not exists post_reactions_post_id_idx on public.post_reactions (post_id);
create index if not exists post_reactions_user_id_idx on public.post_reactions (user_id, created_at desc);

-- ── 3. post_comments (one-level threads) ─────────────────────────────────────

create table if not exists public.post_comments (
  comment_id         uuid primary key default gen_random_uuid(),
  post_id            uuid not null references public.posts(post_id) on delete cascade,
  author_id          uuid not null references public.users(user_id) on delete cascade,
  parent_comment_id  uuid references public.post_comments(comment_id) on delete cascade,
  body               text not null check (char_length(body) between 1 and 2000),
  status             text not null default 'active'
    check (status in ('active', 'deleted')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  edited_at          timestamptz,
  mention_user_ids   uuid[] not null default '{}'::uuid[]
);

create index if not exists post_comments_post_active_idx
  on public.post_comments (post_id, created_at asc)
  where status = 'active';

create index if not exists post_comments_parent_idx
  on public.post_comments (parent_comment_id)
  where parent_comment_id is not null;

create trigger post_comments_set_updated_at
  before update on public.post_comments
  for each row execute function public.set_updated_at();

-- ── 4. post_shares ───────────────────────────────────────────────────────────

create table if not exists public.post_shares (
  share_id           uuid primary key default gen_random_uuid(),
  post_id            uuid not null references public.posts(post_id) on delete cascade,
  user_id            uuid not null references public.users(user_id) on delete cascade,
  share_kind         text not null check (share_kind in ('in_app', 'external')),
  external_channel   text check (external_channel is null or char_length(external_channel) <= 64),
  repost_post_id     uuid references public.posts(post_id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint post_shares_external_channel_chk check (
    (share_kind = 'external' and external_channel is not null)
    or (share_kind = 'in_app' and external_channel is null)
  )
);

create index if not exists post_shares_post_id_idx on public.post_shares (post_id, created_at desc);
create index if not exists post_shares_user_id_idx on public.post_shares (user_id, created_at desc);

-- ── 5. Helpers ─────────────────────────────────────────────────────────────────

create or replace function public.is_post_engagement_visible(p_post_id uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.posts p
     where p.post_id = p_post_id
       and public.is_post_visible_to(p.*, p_viewer)
  );
$$;

revoke all on function public.is_post_engagement_visible(uuid, uuid) from public;
grant execute on function public.is_post_engagement_visible(uuid, uuid) to authenticated, anon, service_role;

comment on function public.is_post_engagement_visible(uuid, uuid) is
  'STABLE visibility gate for engagement rows (KC#867). SECURITY DEFINER to reuse is_post_visible_to without RLS recursion.';

-- ── 6. Counter triggers ────────────────────────────────────────────────────────

create or replace function public.posts_init_post_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.post_stats (post_id) values (new.post_id)
  on conflict (post_id) do nothing;
  return new;
end;
$$;

drop trigger if exists tg_posts_init_post_stats on public.posts;
create trigger tg_posts_init_post_stats
  after insert on public.posts
  for each row execute function public.posts_init_post_stats();

-- Backfill stats rows for existing posts (idempotent).
insert into public.post_stats (post_id)
select p.post_id from public.posts p
on conflict (post_id) do nothing;

create or replace function public.post_stats_bump(
  p_post_id uuid,
  p_reaction_delta int default 0,
  p_comment_delta int default 0,
  p_share_delta int default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.post_stats
     set reaction_count = greatest(0, reaction_count + p_reaction_delta),
         comment_count  = greatest(0, comment_count + p_comment_delta),
         share_count    = greatest(0, share_count + p_share_delta),
         updated_at     = now()
   where post_id = p_post_id;
end;
$$;

revoke all on function public.post_stats_bump(uuid, int, int, int) from public, anon, authenticated;

create or replace function public.trg_post_reactions_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.post_stats_bump(new.post_id, 1, 0, 0);
  elsif tg_op = 'DELETE' then
    perform public.post_stats_bump(old.post_id, -1, 0, 0);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists tg_post_reactions_stats on public.post_reactions;
create trigger tg_post_reactions_stats
  after insert or delete on public.post_reactions
  for each row execute function public.trg_post_reactions_stats();

create or replace function public.trg_post_comments_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.status = 'active' then
    perform public.post_stats_bump(new.post_id, 0, 1, 0);
  elsif tg_op = 'UPDATE' and old.status = 'active' and new.status = 'deleted' then
    perform public.post_stats_bump(new.post_id, 0, -1, 0);
  elsif tg_op = 'DELETE' and old.status = 'active' then
    perform public.post_stats_bump(old.post_id, 0, -1, 0);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists tg_post_comments_stats on public.post_comments;
create trigger tg_post_comments_stats
  after insert or update or delete on public.post_comments
  for each row execute function public.trg_post_comments_stats();

create or replace function public.trg_post_shares_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.post_stats_bump(new.post_id, 0, 0, 1);
  end if;
  return new;
end;
$$;

drop trigger if exists tg_post_shares_stats on public.post_shares;
create trigger tg_post_shares_stats
  after insert on public.post_shares
  for each row execute function public.trg_post_shares_stats();

-- One-level threading: parent must be top-level on the same post.
create or replace function public.post_comments_thread_depth_check()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.parent_comment_id is null then
    return new;
  end if;
  if not exists (
    select 1
      from public.post_comments c
     where c.comment_id = new.parent_comment_id
       and c.post_id = new.post_id
       and c.parent_comment_id is null
       and c.status = 'active'
  ) then
    raise exception 'comment_parent_invalid' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists tg_post_comments_thread_depth on public.post_comments;
create trigger tg_post_comments_thread_depth
  before insert or update of parent_comment_id on public.post_comments
  for each row execute function public.post_comments_thread_depth_check();

-- ── 7. RLS ─────────────────────────────────────────────────────────────────────

alter table public.post_stats enable row level security;
alter table public.post_reactions enable row level security;
alter table public.post_comments enable row level security;
alter table public.post_shares enable row level security;

grant select on public.post_stats to authenticated, anon;
grant select, insert, update, delete on public.post_reactions to authenticated;
grant select, insert, update on public.post_comments to authenticated;
grant select, insert on public.post_shares to authenticated;

create policy post_stats_select_visible on public.post_stats
  for select using (
    public.is_post_engagement_visible(post_id, (select auth.uid()))
  );

create policy post_reactions_select_visible on public.post_reactions
  for select using (
    public.is_post_engagement_visible(post_id, (select auth.uid()))
  );

create policy post_reactions_insert_self on public.post_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_active_member((select auth.uid()))
    and public.is_post_engagement_visible(post_id, (select auth.uid()))
    and not exists (
      select 1 from public.posts p
      where p.post_id = post_reactions.post_id
        and public.is_blocked((select auth.uid()), p.owner_id)
    )
  );

create policy post_reactions_delete_self on public.post_reactions
  for delete to authenticated
  using (user_id = (select auth.uid()));

create policy post_reactions_update_self on public.post_reactions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy post_comments_select_visible on public.post_comments
  for select using (
    status = 'active'
    and public.is_post_engagement_visible(post_id, (select auth.uid()))
  );

create policy post_comments_insert_self on public.post_comments
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.is_active_member((select auth.uid()))
    and public.is_post_engagement_visible(post_id, (select auth.uid()))
    and not exists (
      select 1 from public.posts p
      where p.post_id = post_comments.post_id
        and public.is_blocked((select auth.uid()), p.owner_id)
    )
  );

create policy post_comments_update_self on public.post_comments
  for update to authenticated
  using (
    author_id = (select auth.uid())
    and status = 'active'
  )
  with check (author_id = (select auth.uid()));

create policy post_shares_select_visible on public.post_shares
  for select using (
    public.is_post_engagement_visible(post_id, (select auth.uid()))
  );

create policy post_shares_insert_self on public.post_shares
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_active_member((select auth.uid()))
    and public.is_post_engagement_visible(post_id, (select auth.uid()))
  );
