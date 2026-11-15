-- 0741_offer_photo_required | KC#2020: the server enforces the offer photo rule (D132).
--
-- An offer in items, food, housing or animals needs at least one photo, on create and on edit
-- (an edit can't remove the last photo); requests, rides and every other world stay photo-optional.
-- The app enforces this since KC#2024; until now the server did not:
--   * `create_marketplace_listing` (0667) attached media only when given some, and never checked;
--   * the owner could delete the last `listing_media` row directly (RLS `listing_media_delete_owner`);
--   * the items post engine wrote `posts` and `media_assets` in two requests, so no single
--     transaction ever held both.
--
-- Design (the 0351 precedent, which 0357 dropped):
--   1. `offer_photo_check()` re-reads the post at commit and raises `offer_photo_required` when an
--      offer in a photo world has no `listing_media` row, no `media_assets` row and no legacy
--      details image (`image_url` / `image_path`, accepted since 0351, mirrored by the client).
--   2. Two DEFERRABLE INITIALLY DEFERRED constraint triggers queue that check: one on every new
--      post, one on every deleted `listing_media` row. Checked at commit, so a writer may insert
--      the post first and its photos later in the same transaction, and deleting a post (whose
--      photos go first, or by cascade) passes because the post is gone by then.
--   3. `create_post_with_media` lets the items post engine write the post and its photos in one
--      transaction. A direct `posts` insert of an items offer without photos is now refused.
--
-- Scope: member writes only. A constraint trigger's WHEN clause is evaluated when the row changes,
-- not at commit, so `auth.uid() is not null` there exempts system writers (the kc-dev demo seed
-- runs with the JWT claims cleared, as the write caps expect). Updates of a post never queue the
-- check, so existing offers without photos stay readable and editable (no backfill).
-- `media_assets` deletes are not guarded: the items edit still replaces its photos in two
-- requests (delete, then insert); KC#2118 makes that atomic and adds the guard.

begin;

-- ── 1. The check ─────────────────────────────────────────────────────────────────────────────────

-- True when a post is an offer in a world whose offers need a photo (D132). The one place that
-- lists those worlds on the server; the client mirror is `OFFER_PHOTO_WORLDS` in
-- app/packages/domain/src/marketplace/marketplaceWorldRules.ts.
create or replace function public.offer_requires_photo(p_world_slug text, p_direction text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_direction = 'offer' and p_world_slug in ('items', 'food', 'housing', 'animals');
$$;

comment on function public.offer_requires_photo(text, text) is
  'D132 (KC#2020): true for an offer in items, food, housing or animals, which needs a photo.';

-- The triggers' WHEN clauses run as the writing member, so a member must be able to call it.
revoke all on function public.offer_requires_photo(text, text) from public, anon;
grant execute on function public.offer_requires_photo(text, text) to authenticated;

-- Deferred constraint trigger body for `posts` (insert) and `listing_media` (delete).
-- SECURITY DEFINER: it must see every photo of the post whatever the caller's RLS allows.
create or replace function public.offer_photo_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_id uuid;
  v_post public.posts%rowtype;
begin
  -- Separate branches: PL/pgSQL resolves a record field when the statement is planned, so one
  -- expression naming both `old.listing_id` and `new.post_id` fails on either table.
  if tg_table_name = 'listing_media' then
    v_post_id := old.listing_id;
  else
    v_post_id := new.post_id;
  end if;

  -- Re-read the post as of commit: later statements of the transaction may have changed or
  -- deleted it. A deleted post (or one that is no longer a photo-world offer) needs nothing.
  select * into v_post from public.posts where post_id = v_post_id;
  if not found or not public.offer_requires_photo(v_post.world_slug, v_post.direction) then
    return null;
  end if;

  if exists (select 1 from public.listing_media lm where lm.listing_id = v_post_id)
     or exists (select 1 from public.media_assets ma where ma.post_id = v_post_id)
     or coalesce(nullif(v_post.details ->> 'image_url', ''), nullif(v_post.details ->> 'image_path', '')) is not null
  then
    return null;
  end if;

  raise exception 'offer_photo_required' using errcode = '23514';
end;
$$;

comment on function public.offer_photo_check() is
  'D132 (KC#2020): deferred check that a photo-world offer keeps at least one photo at commit.';

revoke all on function public.offer_photo_check() from public, anon, authenticated;

-- ── 2. The constraint triggers ───────────────────────────────────────────────────────────────────

drop trigger if exists posts_offer_photo_required on public.posts;
create constraint trigger posts_offer_photo_required
  after insert on public.posts
  deferrable initially deferred
  for each row
  when (auth.uid() is not null and public.offer_requires_photo(new.world_slug, new.direction))
  execute function public.offer_photo_check();

drop trigger if exists listing_media_offer_photo_required on public.listing_media;
create constraint trigger listing_media_offer_photo_required
  after delete on public.listing_media
  deferrable initially deferred
  for each row
  when (auth.uid() is not null)
  execute function public.offer_photo_check();

-- ── 3. Items post engine: the post and its photos in one transaction ────────────────────────────

-- SECURITY INVOKER on purpose: the caller's RLS on `posts` and `media_assets` applies exactly as it
-- did to the two direct inserts this replaces (owner, active member, FollowersOnly needs a Private
-- profile), and every column check, trigger and the 5-photo cap still run. The owner is always the
-- caller; `p_post` cannot name another one.
create or replace function public.create_post_with_media(
  p_post jsonb,
  p_media jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if p_post is null or jsonb_typeof(p_post) <> 'object' then
    raise exception 'invalid_post_payload' using errcode = '22023';
  end if;
  if p_media is not null and jsonb_typeof(p_media) <> 'array' then
    raise exception 'invalid_media_payload' using errcode = '22023';
  end if;

  -- jsonb_populate_record casts every field to its column type, so enum and check
  -- violations surface with the same codes the direct insert produced.
  insert into public.posts (
    owner_id, type, visibility, title, description, category, city, street, street_number,
    location_display_level, item_condition, urgency, estimated_value
  )
  select v_uid, r.type, r.visibility, r.title, r.description, r.category, r.city, r.street,
         r.street_number, r.location_display_level, r.item_condition, r.urgency, r.estimated_value
    from jsonb_populate_record(null::public.posts, p_post) r
  returning post_id into v_post_id;

  -- Photos keep the order the client sent; `ordinal` is the array position (0-based).
  insert into public.media_assets (post_id, ordinal, path, mime_type, size_bytes)
  select v_post_id, (m.ord - 1)::smallint, m.item ->> 'path', m.item ->> 'mime_type',
         (m.item ->> 'size_bytes')::integer
    from jsonb_array_elements(coalesce(p_media, '[]'::jsonb)) with ordinality as m(item, ord);

  return v_post_id;
end;
$$;

comment on function public.create_post_with_media(jsonb, jsonb) is
  'KC#2020: items post engine create; inserts the post and its photos in one transaction so the '
  'D132 offer photo check sees both.';

revoke all on function public.create_post_with_media(jsonb, jsonb) from public, anon;
grant execute on function public.create_post_with_media(jsonb, jsonb) to authenticated;

commit;
