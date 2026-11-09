-- 0693_composer_items_post_keeps_kind | An items post from the composer gets its listing kind.
--
-- The composer inserts into `posts` with no kind. The `posts_sync_listing` trigger used to give it
-- one through its listing; 0666 dropped that trigger with nothing in its place, so since then a
-- composer post has no kind and every reader that joins `listing_kinds` skips it, My Listings
-- (`list_my_listings`) first among them.
--
-- The kind is set once, on insert. An explicit kind is kept, and a mirror post (`listing_id` set)
-- is left alone. With a kind now present on a composer post, a later change of its legacy category
-- text must still move its items sub-category, so that case no longer depends on the kind being null.
-- No backfill: no post on kc-dev lacks a kind in a world that has one, and prod has no real data.

begin;

create or replace function public.posts_one_model_derive()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_type_changed boolean := tg_op = 'UPDATE' and new.type is distinct from old.type;
  v_dir_changed  boolean := tg_op = 'UPDATE' and new.direction is distinct from old.direction;
begin
  -- direction ↔ type: on insert the legacy `type` wins (it is NOT NULL, every writer sends it);
  -- on update whichever side changed drives the other.
  if tg_op = 'INSERT' or v_type_changed or not v_dir_changed then
    new.direction := case new.type when 'Request' then 'request' else 'offer' end;
  else
    new.type := case new.direction when 'request' then 'Request' else 'Give' end;
  end if;

  -- A mirror belongs to its listing's world; a native post to the items world unless told otherwise.
  if new.listing_id is not null and new.listing_world_slug is not null then
    new.world_slug := new.listing_world_slug;
  end if;
  new.post_type := case when new.world_slug = 'rides' then 'ride'
                        when new.post_type = 'ride' then 'standard'
                        else new.post_type end;

  -- Native items posts: legacy category text → items sub-category. A post written with a kind
  -- brings its own sub-category; after that only a change of the text moves it.
  if new.listing_id is null and new.world_slug = 'items'
     and ((new.kind_id is null and (tg_op = 'INSERT' or new.category_id is null))
          or (tg_op = 'UPDATE' and new.category is distinct from old.category)) then
    select c.category_id into new.category_id
      from public.categories c
     where c.world_slug = 'items' and c.legacy_post_category = new.category
     order by c.sort_order limit 1;
  end if;

  -- Native items posts from the composer carry no kind of their own.
  if tg_op = 'INSERT' and new.listing_id is null and new.kind_id is null and new.world_slug = 'items' then
    new.kind_id := public.listing_kind_for_post('items', new.direction);
  end if;

  if new.listing_id is null then
    if new.geo is null or (tg_op = 'UPDATE' and new.city is distinct from old.city) then
      new.geo := public.listing_geo_from_city(new.city);
    end if;
  end if;
  return new;
end;
$$;

commit;
