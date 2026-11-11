-- 0333_listing_media | Epic #893 follow-up — gallery images for marketplace listings.

begin;

create table if not exists public.listing_media (
  media_id     uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references public.listings(listing_id) on delete cascade,
  storage_path text not null,
  sort_order   smallint not null default 0 check (sort_order >= 0 and sort_order < 10),
  created_at   timestamptz not null default now(),
  constraint listing_media_listing_path_unique unique (listing_id, storage_path)
);

create index if not exists listing_media_listing_sort_idx
  on public.listing_media (listing_id, sort_order);

alter table public.listing_media enable row level security;

create policy listing_media_select_visible on public.listing_media
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.listings l
       where l.listing_id = listing_media.listing_id
         and l.moderation_status = 'published'
         and public.is_listing_visible_to(l, auth.uid())
    )
  );

create policy listing_media_insert_owner on public.listing_media
  for insert to authenticated
  with check (
    exists (
      select 1 from public.listings l
       where l.listing_id = listing_media.listing_id
         and l.owner_id = auth.uid()
    )
  );

create policy listing_media_delete_owner on public.listing_media
  for delete to authenticated
  using (
    exists (
      select 1 from public.listings l
       where l.listing_id = listing_media.listing_id
         and l.owner_id = auth.uid()
    )
  );

insert into storage.buckets (id, name, public)
values ('listing-images', 'listing-images', true)
on conflict (id) do nothing;

create policy listing_images_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy listing_images_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy listing_images_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy listing_images_read_public on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'listing-images');

commit;
