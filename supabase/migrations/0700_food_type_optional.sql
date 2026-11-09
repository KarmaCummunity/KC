-- 0700_food_type_optional | KC#1398, {{D:food-type-is-subcategory}}
--
-- A food offer named its type twice: the `food_type` detail field and the food world's
-- sub-category (cooked-ready, fresh-raw, packaged, frozen, ...). The create form now shows only
-- the sub-category and requires it on an offer, so `give_food` no longer requires `food_type`.
--
-- The property stays in the schema: app builds released before this change still send it, and
-- the server must keep accepting their offers. Only the `required` list changes; `expires_at`
-- stays required (D28). Idempotent: the update is a no-op once `food_type` is gone from it.

update public.listing_kinds
   set detail_schema = jsonb_set(
         detail_schema,
         '{required}',
         coalesce(
           (select jsonb_agg(key) from jsonb_array_elements_text(detail_schema -> 'required') as r(key)
             where key <> 'food_type'),
           '[]'::jsonb))
 where world_slug = 'food'
   and slug = 'give_food'
   and detail_schema -> 'required' ? 'food_type';
