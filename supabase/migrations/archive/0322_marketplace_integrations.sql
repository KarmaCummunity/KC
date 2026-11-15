-- 0322_marketplace_integrations | Epic #893 / #907
-- Feed, chat, matching, and WhatsApp bot linkage for native listings.

begin;

alter table public.chats
  add column if not exists anchor_listing_id uuid
    references public.listings(listing_id) on delete set null;

create index if not exists chats_anchor_listing_idx
  on public.chats (anchor_listing_id) where anchor_listing_id is not null;

create table if not exists public.listing_feed_posts (
  listing_id uuid primary key references public.listings(listing_id) on delete cascade,
  post_id    uuid not null unique references public.posts(post_id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.listing_feed_posts enable row level security;

create policy listing_feed_posts_select_visible on public.listing_feed_posts
  for select using (
    exists (
      select 1 from public.listings l
       where l.listing_id = listing_feed_posts.listing_id
         and public.is_listing_visible_to(l, auth.uid())
    )
  );

create or replace function public.share_listing_to_feed(p_listing_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_listing public.listings;
  v_post_id uuid;
  v_city text;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  select * into v_listing from public.listings where listing_id = p_listing_id;
  if not found or v_listing.owner_id <> v_uid then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select post_id into v_post_id from public.listing_feed_posts where listing_id = p_listing_id;
  if v_post_id is not null then
    return v_post_id;
  end if;

  v_city := coalesce(v_listing.city_id, 'tel-aviv');

  insert into public.posts (
    owner_id, type, status, visibility, title, description, category, city, street, street_number
  ) values (
    v_listing.owner_id,
    case when v_listing.direction = 'request' then 'Request' else 'Give' end,
    'open',
    public.anonymity_level_to_visibility(v_listing.anonymity_level),
    v_listing.title,
    coalesce(v_listing.summary, left(v_listing.details::text, 500)),
    'Other',
    v_city,
    'Marketplace',
    '1'
  )
  returning post_id into v_post_id;

  insert into public.listing_feed_posts (listing_id, post_id) values (p_listing_id, v_post_id);
  return v_post_id;
end;
$$;

revoke all on function public.share_listing_to_feed(uuid) from public;
grant execute on function public.share_listing_to_feed(uuid) to authenticated;

create or replace function public.start_listing_chat(p_listing_id uuid, p_opening_message text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_listing public.listings;
  v_other uuid;
  v_chat_id uuid;
  v_a uuid;
  v_b uuid;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  select * into v_listing from public.listings where listing_id = p_listing_id;
  if not found or not public.is_listing_visible_to(v_listing, v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_other := v_listing.owner_id;
  if v_other = v_uid then
    raise exception 'cannot_chat_self' using errcode = '22023';
  end if;

  v_a := least(v_uid, v_other);
  v_b := greatest(v_uid, v_other);

  select chat_id into v_chat_id
    from public.chats
   where participant_a = v_a and participant_b = v_b and anchor_listing_id = p_listing_id;

  if v_chat_id is null then
    insert into public.chats (participant_a, participant_b, anchor_listing_id)
    values (v_a, v_b, p_listing_id)
    on conflict (participant_a, participant_b) do update
      set anchor_listing_id = coalesce(public.chats.anchor_listing_id, excluded.anchor_listing_id)
    returning chat_id into v_chat_id;
  end if;

  if p_opening_message is not null and char_length(trim(p_opening_message)) > 0 then
    insert into public.messages (chat_id, sender_id, kind, body, status)
    values (v_chat_id, v_uid, 'user', trim(p_opening_message), 'pending');
  end if;

  return v_chat_id;
end;
$$;

revoke all on function public.start_listing_chat(uuid, text) from public;
grant execute on function public.start_listing_chat(uuid, text) to authenticated;

create or replace function public.listings_enqueue_match_on_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.moderation_status = 'published'
     and new.status = 'open'
     and (tg_op = 'INSERT'
          or old.moderation_status is distinct from new.moderation_status
          or old.status is distinct from new.status) then
    insert into public.match_runs (source_listing_id, triggered_by, stats)
    values (new.listing_id, new.owner_id, jsonb_build_object('source', 'publish_hook'));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_listings_enqueue_match on public.listings;
create trigger trg_listings_enqueue_match
  after insert or update of moderation_status, status on public.listings
  for each row execute function public.listings_enqueue_match_on_publish();

commit;
