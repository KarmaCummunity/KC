-- Social · post_comment_reactions, post_shares, saved_posts
--
-- Three small member-owned tables. All of them are written as plain rows under RLS: each
-- rule is "my own row, on something I can read", which a policy expresses in full.

-- ── Likes on comments (D25) ──────────────────────────────────────────────────
create table public.post_comment_reactions (
  comment_id uuid not null references public.post_comments (id) on delete cascade,
  user_id    uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
comment on table public.post_comment_reactions is 'One like per member per comment.';

-- Removal of a member's likes with their account; covers the user foreign key.
create index post_comment_reactions_user_idx on public.post_comment_reactions (user_id);

alter table public.post_comment_reactions enable row level security;
alter table public.post_comment_reactions force row level security;

-- Visible when the comment is (which in turn requires its post) and the member who liked
-- is; both subqueries run under the caller's own access.
create policy post_comment_reactions_select_visible on public.post_comment_reactions
  for select to authenticated
  using (
    exists (select 1 from public.post_comments c where c.id = post_comment_reactions.comment_id)
    and exists (select 1 from public.users u where u.id = post_comment_reactions.user_id));

create policy post_comment_reactions_insert_self on public.post_comment_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.users u where u.id = (select auth.uid()) and u.is_active)
    and exists (select 1 from public.post_comments c where c.id = post_comment_reactions.comment_id));

create policy post_comment_reactions_delete_self on public.post_comment_reactions
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on public.post_comment_reactions to authenticated;

-- ── Shares (FR-POST-023) ─────────────────────────────────────────────────────
-- A log of "this member shared this post", kept for the share counter. Append-only.
create table public.post_shares (
  id               uuid primary key default gen_random_uuid(),
  post_id          uuid not null references public.posts (id) on delete cascade,
  user_id          uuid not null references public.users (id) on delete cascade,
  -- 'in_app' to another member inside the product; 'external' through the device share sheet.
  share_kind       text not null check (share_kind in ('in_app', 'external')),
  -- Where an external share went, as the share sheet reports it (for example 'whatsapp').
  external_channel text check (char_length(external_channel) between 1 and 64),
  created_at       timestamptz not null default now(),
  constraint post_shares_channel_chk check ((share_kind = 'external') = (external_channel is not null))
);
comment on table public.post_shares is 'Append-only log of post shares; feeds post_stats.shares_count.';

-- Removal with the post, and with the member; cover the two foreign keys.
create index post_shares_post_idx on public.post_shares (post_id);
create index post_shares_user_idx on public.post_shares (user_id, created_at desc);

-- Keeps post_stats.shares_count in step, once per statement.
create function kc_private.post_shares_sync_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.post_stats_add(
    'shares', case tg_op when 'INSERT' then 1 else -1 end, array(select c.post_id from changed c));
  return null;
end;
$$;

create trigger post_shares_count_insert
  after insert on public.post_shares
  referencing new table as changed
  for each statement execute function kc_private.post_shares_sync_stats();
create trigger post_shares_count_delete
  after delete on public.post_shares
  referencing old table as changed
  for each statement execute function kc_private.post_shares_sync_stats();

alter table public.post_shares enable row level security;
alter table public.post_shares force row level security;

-- Who shared what is the sharer's own business; everyone else sees only the counter.
create policy post_shares_select_own on public.post_shares
  for select to authenticated
  using (user_id = (select auth.uid()));

-- A member with an active account logs a share of a published post they can read that is
-- public, or their own (FR-POST-023 AC1).
create policy post_shares_insert_self on public.post_shares
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.users u where u.id = (select auth.uid()) and u.is_active)
    and exists (select 1 from public.posts p
                 where p.id = post_shares.post_id and p.status in ('open', 'closed_delivered')
                   and (p.visibility = 'Public' or p.owner_id = (select auth.uid()))));

grant select on public.post_shares to authenticated;
grant insert (id, post_id, user_id, share_kind, external_channel) on public.post_shares to authenticated;

-- ── Saved posts (FR-POST-022) ────────────────────────────────────────────────
create table public.saved_posts (
  user_id  uuid not null references public.users (id) on delete cascade,
  post_id  uuid not null references public.posts (id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
comment on table public.saved_posts is 'A member''s private bookmarks.';

-- "My saved posts", newest first (keyset on saved_at, post_id) (FR-PROFILE-016).
create index saved_posts_user_recent_idx on public.saved_posts (user_id, saved_at desc, post_id);
-- Removal with the post; covers the post foreign key.
create index saved_posts_post_idx on public.saved_posts (post_id);

alter table public.saved_posts enable row level security;
alter table public.saved_posts force row level security;

create policy saved_posts_select_own on public.saved_posts
  for select to authenticated
  using (user_id = (select auth.uid()));

-- A member saves any post they can read at that moment (FR-POST-022 AC2). A bookmark of a
-- post that later leaves the member's sight stays, and simply resolves to nothing.
create policy saved_posts_insert_self on public.saved_posts
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.posts p where p.id = saved_posts.post_id));

create policy saved_posts_delete_own on public.saved_posts
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, delete on public.saved_posts to authenticated;
grant insert (user_id, post_id) on public.saved_posts to authenticated;
