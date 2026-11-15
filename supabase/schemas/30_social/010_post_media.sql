-- Social · post_media (one row per file attached to a post)
--
-- The file itself lives in object storage; the database holds what a card needs to lay the
-- media out before it loads (size, blurhash) and where to fetch it (design §5.3). A device
-- uploads straight to storage under its own folder and then records the row as `pending`;
-- the media pipeline strips EXIF, builds the fixed variants and marks the row `ready`
-- (FR-POST-005 AC3, AC4). Other members only ever see `ready` media.

insert into kc_private.fsm_state (machine_id, status) values
  ('post_media', 'pending'),
  ('post_media', 'ready'),
  ('post_media', 'failed');

-- Only the media pipeline (role `system`) moves a file out of `pending`.
insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  ('post_media', 'pending', 'ready', 'system'),
  ('post_media', 'pending', 'failed', 'system');

create table public.post_media (
  id                uuid primary key default gen_random_uuid(),
  post_id           uuid not null references public.posts (id) on delete cascade,
  -- Always the post's owner; kept on the row so the storage folder rule and the purge of a
  -- member's files need no join.
  owner_id          uuid not null references public.users (id) on delete cascade,
  kind              text not null default 'image' check (kind in ('image', 'video')),
  storage_bucket    text not null default 'post-images' check (storage_bucket ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  -- Object path inside the bucket; for video, the provider's asset id (design §5.3).
  storage_key       text not null check (char_length(storage_key) between 1 and 512),
  -- Position in the post's gallery, 0 first. The range is the cap: five files per post
  -- (FR-POST-005 AC2).
  ordinal           smallint not null check (ordinal between 0 and 4),
  mime_type         text not null,
  size_bytes        bigint not null check (size_bytes > 0),
  width             integer check (width > 0),
  height            integer check (height > 0),
  duration_ms       integer check (duration_ms > 0),
  -- Compact placeholder painted while the file loads.
  blurhash          text check (char_length(blurhash) between 6 and 64),
  -- Lifecycle, machine `post_media`. Never written by a device.
  processing_status text not null default 'pending',
  created_at        timestamptz not null default now(),
  constraint post_media_post_ordinal_key unique (post_id, ordinal),
  constraint post_media_storage_object_key unique (storage_bucket, storage_key),
  -- A member's files live under a folder named by their id (design §4 "Storage").
  constraint post_media_owner_folder_chk check (starts_with(storage_key, owner_id::text || '/')),
  -- Images: JPEG or PNG, at most 8 MB after the client-side resize (FR-POST-005 AC1, AC2).
  constraint post_media_image_chk check (
    kind <> 'image' or (mime_type in ('image/jpeg', 'image/png') and size_bytes <= 8388608 and duration_ms is null)),
  constraint post_media_video_chk check (kind <> 'video' or mime_type like 'video/%')
);
comment on table public.post_media is 'Files attached to a post: location in storage, layout hints and processing status.';

-- Gallery of a post in order and the cover of a card are served by post_media_post_ordinal_key.
-- Files of a member: the account purge deletes them from storage first; covers the foreign key.
create index post_media_owner_idx on public.post_media (owner_id);

create trigger post_media_status_fsm
  before insert or update of processing_status on public.post_media
  for each row execute function kc_private.fsm_guard_status('post_media', 'processing_status');

alter table public.post_media enable row level security;
alter table public.post_media force row level security;

-- The owner sees every file of theirs. Anyone else sees processed files of a post they can
-- read: the subquery runs under the caller's own access to `posts`, so the post decides.
create policy post_media_select_visible on public.post_media
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (processing_status = 'ready'
        and exists (select 1 from public.posts p where p.id = post_media.post_id)));

-- The owner attaches a file to a post of theirs while its content is editable (draft, open
-- or paused, D104). The row always starts `pending`.
create policy post_media_insert_owner on public.post_media
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and processing_status = 'pending'
    and exists (select 1 from public.posts p
                 where p.id = post_media.post_id and p.owner_id = (select auth.uid())
                   and p.status in ('draft', 'open', 'paused'))
    and exists (select 1 from public.users u where u.id = (select auth.uid()) and u.is_active));

-- The owner removes a file under the same condition. The object itself is removed by the
-- orphan reconciliation job (design §5.3).
create policy post_media_delete_owner on public.post_media
  for delete to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (select 1 from public.posts p
                 where p.id = post_media.post_id and p.status in ('draft', 'open', 'paused')));

grant select, delete on public.post_media to authenticated;
-- Not insertable: processing_status (starts `pending`) and created_at.
grant insert (
  id, post_id, owner_id, kind, storage_bucket, storage_key, ordinal, mime_type, size_bytes,
  width, height, duration_ms, blurhash
) on public.post_media to authenticated;
