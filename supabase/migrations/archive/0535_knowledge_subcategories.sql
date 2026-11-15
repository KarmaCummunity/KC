-- 0535_knowledge_subcategories | #1468: seed the four decided knowledge subcategories.
-- Mapped to spec: docs/spec/05_giving_worlds.md §5.7. Idempotent; leaves existing rows untouched.

insert into public.categories (world_slug, parent_id, slug, label_he, label_en, sort_order)
select 'knowledge', p.category_id, v.slug, v.label_he, v.label_en, v.ord
from public.categories p
cross join (values
  ('science_technology', 'מדע וטכנולוגיה', 'Science & technology', 8),
  ('history_heritage', 'היסטוריה ומורשת', 'History & heritage', 9),
  ('culture_art', 'תרבות ואמנות', 'Culture & art', 10),
  ('spirituality_philosophy', 'רוחניות ופילוסופיה', 'Spirituality & philosophy', 11)
) as v(slug, label_he, label_en, ord)
where p.world_slug = 'knowledge' and p.slug = 'knowledge'
on conflict (world_slug, slug) do nothing;
