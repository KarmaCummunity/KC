-- 0002_init_posts | P0.2.b — Posts core (posts, media_assets, recipients, visibility helper)
-- FR-POST-001..020, FR-FEED-001..002, FR-CLOSURE-002..003 (closure flow ships later; row shape only)
--
-- Visibility model recap:
--   Public        — everyone (subject to block check; block check ships P0.2.c)
--   FollowersOnly — owner + approved followers (follower check ships P0.2.c)
--   OnlyMe        — owner only
-- The is_post_visible_to() helper below has a deliberately conservative
-- FollowersOnly branch for now (returns false for non-owners). Replace its
-- body in P0.2.c once follow_edges + blocks land.

-- ── 1. posts ─────────────────────────────────────────────────────────────────
create table if not exists public.posts (
  post_id                 uuid primary key default gen_random_uuid(),
  owner_id                uuid not null references public.users(user_id) on delete cascade,
  type                    text not null check (type in ('Give','Request')),
  status                  text not null default 'open'
    check (status in ('open','closed_delivered','deleted_no_recipient','expired','removed_admin')),
  visibility              text not null default 'Public'
    check (visibility in ('Public','FollowersOnly','OnlyMe')),
  title                   text not null check (char_length(title) between 1 and 80),
  description             text check (description is null or char_length(description) <= 500),
  category                text not null default 'Other'
    check (category in (
      'Furniture','Clothing','Books','Toys','BabyGear',
      'Kitchen','Sports','Electronics','Tools','Other'
    )),
  -- Address (inlined value object). city FKs cities; street is free text.
  city                    text not null references public.cities(city_id),
  street                  text not null check (char_length(street) between 1 and 80),
  street_number           text not null check (street_number ~ '^[0-9]+[A-Za-z]?$'),
  location_display_level  text not null default 'CityAndStreet'
    check (location_display_level in ('CityOnly','CityAndStreet','FullAddress')),
  -- Type-specific (NULL for the other type)
  item_condition          text
    check (item_condition is null or item_condition in ('New','LikeNew','Good','Fair')),
  urgency                 text check (urgency is null or char_length(urgency) <= 100),
  -- Closure / lifecycle
  reopen_count            integer not null default 0 check (reopen_count >= 0),
  delete_after            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  -- Type/condition coupling (FR-POST-004): condition only for Give; urgency only for Request.
  constraint posts_type_fields_chk check (
    (type = 'Give'    and urgency is null)
    or (type = 'Request' and item_condition is null)
  )
);

-- Hot-path indexes for the feed (FR-FEED-001 / FR-FEED-006).
create index posts_open_public_recent_idx
  on public.posts (created_at desc)
  where status = 'open' and visibility = 'Public';

-- General lookups
create index posts_owner_status_idx on public.posts (owner_id, status);
create index posts_city_status_idx  on public.posts (city, status) where status = 'open';
create index posts_status_idx       on public.posts (status);

create trigger posts_set_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

-- ── 2. Visibility upgrade-only rule (FR-POST-009) ────────────────────────────
create or replace function public.posts_visibility_upgrade_check()
returns trigger language plpgsql as $$
declare
  rank_old int;
  rank_new int;
begin
  if old.visibility = new.visibility then
    return new;
  end if;
  -- Lower rank = more private. Allowed: rank_new >= rank_old.
  rank_old := case old.visibility
    when 'OnlyMe' then 0
    when 'FollowersOnly' then 1
    when 'Public' then 2
  end;
  rank_new := case new.visibility
    when 'OnlyMe' then 0
    when 'FollowersOnly' then 1
    when 'Public' then 2
  end;
  if rank_new < rank_old then
    raise exception 'visibility_downgrade_forbidden'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger posts_visibility_upgrade_only
  before update of visibility on public.posts
  for each row execute function public.posts_visibility_upgrade_check();

-- ── 3. Active-posts cap (FR-POST-011, R-MVP-Items-8) ─────────────────────────
-- Server-side enforcement of "max 20 open posts per user" (OnlyMe counts).
create or replace function public.posts_enforce_active_cap()
returns trigger language plpgsql as $$
declare
  active_n int;
begin
  if new.status = 'open' and (tg_op = 'INSERT' or old.status <> 'open') then
    select count(*) into active_n
    from public.posts
    where owner_id = new.owner_id and status = 'open';
    if active_n >= 20 then
      raise exception 'active_post_limit_exceeded'
        using errcode = 'check_violation', detail = 'limit=20';
    end if;
  end if;
  return new;
end;
$$;

create trigger posts_active_cap_on_insert
  before insert on public.posts
  for each row execute function public.posts_enforce_active_cap();

create trigger posts_active_cap_on_status_change
  before update of status on public.posts
  for each row execute function public.posts_enforce_active_cap();

-- ── 4. media_assets ─────────────────────────────────────────────────────────
create table if not exists public.media_assets (
  media_asset_id  uuid primary key default gen_random_uuid(),
  post_id         uuid not null references public.posts(post_id) on delete cascade,
  ordinal         smallint not null check (ordinal between 0 and 4),
  path            text not null,            -- relative path inside the post-images bucket
  mime_type       text not null check (mime_type in ('image/jpeg','image/png','image/heic')),
  size_bytes      integer not null check (size_bytes > 0 and size_bytes <= 8 * 1024 * 1024),
  created_at      timestamptz not null default now(),
  unique (post_id, ordinal)
);

create index media_assets_post_id_idx on public.media_assets (post_id, ordinal);

-- Cap of 5 images per post (FR-POST-005 AC2).
create or replace function public.media_assets_enforce_cap()
returns trigger language plpgsql as $$
declare
  count_for_post int;
begin
  select count(*) into count_for_post
  from public.media_assets
  where post_id = new.post_id;
  if count_for_post >= 5 then
    raise exception 'media_asset_limit_exceeded'
      using errcode = 'check_violation', detail = 'limit=5';
  end if;
  return new;
end;
$$;

create trigger media_assets_cap_on_insert
  before insert on public.media_assets
  for each row execute function public.media_assets_enforce_cap();

-- ── 5. recipients (closure target, at most one per post) ────────────────────
create table if not exists public.recipients (
  post_id             uuid primary key references public.posts(post_id) on delete cascade,
  recipient_user_id   uuid not null references public.users(user_id) on delete cascade,
  marked_at           timestamptz not null default now()
);

create index recipients_user_id_idx on public.recipients (recipient_user_id);

-- ── 6. Visibility predicate ─────────────────────────────────────────────────
-- Used by RLS policies and by feed/search queries via repository adapters.
-- INTERIM SHAPE: FollowersOnly returns false for non-owners until P0.2.c
-- introduces follow_edges and blocks. Block-aware Public visibility is also
-- deferred to P0.2.c. Replace the function body there; the call sites stay.
create or replace function public.is_post_visible_to(p_post public.posts, p_viewer uuid)
returns boolean language sql stable as $$
  select case
    -- Owner always sees their own row, in any status / any visibility.
    when p_post.owner_id = p_viewer then true
    -- Removed-by-admin and the closure soft-delete tomb are owner-only views.
    when p_post.status in ('removed_admin','deleted_no_recipient','expired') then false
    -- Closed posts: visible to the recipient (FR-POST-017), hidden from the rest.
    when p_post.status = 'closed_delivered' then exists (
      select 1 from public.recipients r
      where r.post_id = p_post.post_id and r.recipient_user_id = p_viewer
    )
    -- Open posts: visibility-driven.
    when p_post.status = 'open' and p_post.visibility = 'Public' then true
    when p_post.status = 'open' and p_post.visibility = 'OnlyMe' then false
    when p_post.status = 'open' and p_post.visibility = 'FollowersOnly' then false  -- TODO P0.2.c
    else false
  end;
$$;

-- ── 7. RLS ──────────────────────────────────────────────────────────────────
alter table public.posts          enable row level security;
alter table public.media_assets   enable row level security;
alter table public.recipients     enable row level security;

-- 7.1 posts: SELECT via the visibility predicate (handles all cases).
create policy posts_select_visible on public.posts
  for select using (public.is_post_visible_to(posts.*, auth.uid()));

-- 7.2 posts: INSERT — the row's owner must equal the caller. Active-cap enforced
--     by trigger (above). FollowersOnly only when caller is Private (FR-POST-003 AC4).
create policy posts_insert_self on public.posts
  for insert with check (
    auth.uid() = owner_id
    and (
      visibility <> 'FollowersOnly'
      or exists (
        select 1 from public.users u
        where u.user_id = auth.uid() and u.privacy_mode = 'Private'
      )
    )
  );

-- 7.3 posts: UPDATE — owner only. Visibility-upgrade-only enforced by trigger.
create policy posts_update_self on public.posts
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- 7.4 posts: DELETE — owner only, and only when status = open (FR-POST-010).
--     Closing is an UPDATE to status, not a DELETE.
create policy posts_delete_self_open on public.posts
  for delete using (auth.uid() = owner_id and status = 'open');

-- 7.5 media_assets: SELECT — piggyback on post visibility.
create policy media_assets_select_visible on public.media_assets
  for select using (
    exists (
      select 1 from public.posts p
      where p.post_id = media_assets.post_id
        and public.is_post_visible_to(p.*, auth.uid())
    )
  );

create policy media_assets_insert_owner on public.media_assets
  for insert with check (
    exists (
      select 1 from public.posts p
      where p.post_id = media_assets.post_id and p.owner_id = auth.uid()
    )
  );

create policy media_assets_delete_owner on public.media_assets
  for delete using (
    exists (
      select 1 from public.posts p
      where p.post_id = media_assets.post_id and p.owner_id = auth.uid()
    )
  );

-- 7.6 recipients: SELECT visible to the post owner and to the recipient.
create policy recipients_select_participants on public.recipients
  for select using (
    auth.uid() = recipient_user_id
    or exists (
      select 1 from public.posts p
      where p.post_id = recipients.post_id and p.owner_id = auth.uid()
    )
  );

-- INSERT only by the post owner (i.e. closure with recipient mark — FR-CLOSURE-003 AC5).
create policy recipients_insert_owner on public.recipients
  for insert with check (
    exists (
      select 1 from public.posts p
      where p.post_id = recipients.post_id and p.owner_id = auth.uid()
    )
  );

-- DELETE either by the post owner (reopen — FR-CLOSURE-005) or by the recipient
-- themselves (un-mark — FR-CLOSURE-007).
create policy recipients_delete_participants on public.recipients
  for delete using (
    auth.uid() = recipient_user_id
    or exists (
      select 1 from public.posts p
      where p.post_id = recipients.post_id and p.owner_id = auth.uid()
    )
  );

-- ── 8. Storage bucket for post images ───────────────────────────────────────
-- Single public bucket. Public read because feed thumbnails need to be served
-- from <img src>; for OnlyMe / FollowersOnly the post row itself is hidden by
-- RLS, so the URL of an image inside an unlisted post is non-discoverable.
-- Tightening to per-post signed URLs is tracked as TD-11 (added below in §9).
insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do update set public = excluded.public;

-- Each user uploads under a path namespaced by their user_id, e.g.
--   <user_id>/<post_id>/<ordinal>.jpg
create policy post_images_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy post_images_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy post_images_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy post_images_read_public on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'post-images');

-- ── 9. Grants ───────────────────────────────────────────────────────────────
grant select          on public.posts          to anon, authenticated;
grant insert, delete  on public.posts          to authenticated;
grant update (
  status, visibility, title, description, category,
  city, street, street_number, location_display_level,
  item_condition, urgency, delete_after, reopen_count, updated_at
) on public.posts to authenticated;

grant select          on public.media_assets   to anon, authenticated;
grant insert, delete  on public.media_assets   to authenticated;

grant select          on public.recipients     to authenticated;
grant insert, delete  on public.recipients     to authenticated;
