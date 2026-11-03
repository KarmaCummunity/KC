-- 0462_listing_world_subcategory_guard | KC#1296 — a listing's world subcategory must belong to
-- the listing's own giving world.
--
-- The create form now sends `p_category_id` (items / food world subcategories, 0241) to
-- `create_marketplace_listing` (0353), which stores it unchecked. A subcategory from another
-- world would mislabel the listing and feed a wrong category score to matching (0421), so the
-- write is rejected with `category_world_mismatch` (23514).
--
-- Mapped to spec: docs/spec/94_glossary_and_naming.md (world subcategory),
-- docs/spec/05_giving_worlds.md (items / food). Idempotent.

create or replace function public.listings_category_matches_world()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.categories c
     where c.category_id = new.category_id
       and c.world_slug = new.world_slug
  ) then
    raise exception 'category_world_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function public.listings_category_matches_world() is
  'Rejects a listing whose category_id belongs to another giving world (category_world_mismatch, 23514). KC#1296.';

drop trigger if exists listings_category_matches_world on public.listings;
create trigger listings_category_matches_world
  before insert or update of category_id, world_slug on public.listings
  for each row execute function public.listings_category_matches_world();
