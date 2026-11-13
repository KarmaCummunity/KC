-- Demo data (FR-ADMIN-031) · restore phases "items" and "rides": posts of the demo members.
--
-- Rows are written directly (the restore runs without a caller identity, so no member quota
-- or rate limit applies), but every baseline trigger still runs: the status machine, the
-- open-post cap of 20 per member, derived locations, counters and the ride rules. Positions
-- are derived from the row number, so each restore publishes the same posts.

-- Three item posts per member, 70% offers, in the items world. Audience mix (FR-POST-009):
-- one in ten followers-only, one in thirty only-me. Returns the number of posts created.
create or replace function kc_private.demo_seed_items()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- (item subcategory slug, title, description)
  v_items constant text[][] := array[
    array['furniture', 'ספה תלת מושבית', 'ספה אפורה במצב טוב, צריך להגיע עם עוד מישהו להרים'],
    array['furniture', 'שולחן אוכל עם 4 כיסאות', 'עץ מלא, קצת שריטות'],
    array['furniture', 'ארון בגדים 3 דלתות', 'מפורק ומוכן לאיסוף'],
    array['clothing', 'שקית בגדי תינוק 0-6 חודשים', 'נקי ומקופל, בנים'],
    array['clothing', 'מעיל חורף מידה L', 'כמעט לא נלבש'],
    array['books', 'ספרי לימוד לכיתה ה', 'סט מלא, מחברות לא כלולות'],
    array['books', 'ספרי קריאה לילדים', 'כ-30 ספרים בעברית'],
    array['toys', 'לגו מעורב', 'קופסה גדולה של לגו'],
    array['baby_gear', 'עגלת תינוק', 'עגלה מתקפלת, נקייה'],
    array['baby_gear', 'מיטת תינוק', 'כולל מזרן'],
    array['kitchen', 'סט סירים', '5 סירים נירוסטה'],
    array['kitchen', 'מיקרוגל', 'עובד מצוין'],
    array['sports', 'אופני ילדים 20 אינץ', 'צריך לנפח גלגלים'],
    array['electronics', 'מסך מחשב 24 אינץ', 'חיבור HDMI'],
    array['electronics', 'מקרר קטן', 'מתאים למשרד או לחדר סטודנט'],
    array['tools', 'מקדחה חשמלית', 'עם סט מקדחים'],
    array['other', 'עציצים וצמחי בית', 'כמה עציצים קטנים']];
  v_members constant uuid[] := kc_private.demo_member_ids();
  v_count constant integer := cardinality(kc_private.demo_member_ids());
  v_created integer;
begin
  if v_count = 0 then
    return 0;
  end if;

  insert into public.posts (owner_id, world_slug, kind_id, direction, status, visibility, title,
                            description, item_subcategory_id, city_id, location_display_level,
                            urgency_level, source_language, published_at, created_at)
  select s.owner_id, 'items', k.id, s.direction, 'open',
         case when s.g % 30 = 0 then 'OnlyMe' when s.g % 10 = 0 then 'FollowersOnly' else 'Public' end,
         case when s.direction = 'request' then 'מחפש/ת: ' || v_items[s.item][2] else v_items[s.item][2] end,
         v_items[s.item][3], sc.id, u.city_id, 'CityOnly',
         case when s.direction = 'request' and s.g % 3 = 0 then 3 end,
         'he', s.at, s.at
    from (select g, v_members[1 + (g * 17) % v_count] as owner_id,
                 case when g % 10 < 7 then 'offer' else 'request' end as direction,
                 1 + (g * 5) % array_length(v_items, 1) as item,
                 now() - make_interval(days => g % 60, hours => g % 24) as at
            from generate_series(1, v_count * 3) g) s
    join public.users u on u.id = s.owner_id and u.city_id is not null
    join lateral (select k.id from public.post_kinds k
                   where k.world_slug = 'items' and k.is_active and k.direction in (s.direction, 'either')
                   order by k.direction = s.direction desc, k.sort_order limit 1) k on true
    left join public.item_subcategories sc on sc.world_slug = 'items' and sc.slug = v_items[s.item][1];
  get diagnostics v_created = row_count;
  return v_created;
end;
$$;
comment on function kc_private.demo_seed_items() is
  'Demo restore phase "items": three item posts per demo member (offers and requests).';

-- The plan of the 120 demo rides, one row per ride: two thirds offers by declared drivers, one
-- third requests; two different cities of the pool; departures over the next two weeks. The
-- id is derived from the position, so the post and its ride row are written by two plain
-- inserts that read the same plan.
create or replace function kc_private.demo_ride_plan()
returns table (g integer, id uuid, direction text, owner_id uuid, origin_city_id text, dest_city_id text,
               departs_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with pool as (
    select kc_private.demo_member_ids() as members, kc_private.demo_driver_ids() as drivers,
           kc_private.demo_city_pool() as cities)
  select s.g, md5('kc-demo-ride-' || s.g)::uuid,
         case when s.g % 3 = 0 then 'request' else 'offer' end,
         case when s.g % 3 = 0 then p.members[1 + (s.g * 19) % cardinality(p.members)]
              else p.drivers[1 + (s.g * 7) % cardinality(p.drivers)] end,
         p.cities[1 + s.g % cardinality(p.cities)],
         -- An offset of 1 … n-1 positions, so the destination is never the origin.
         p.cities[1 + (s.g % cardinality(p.cities) + 1 + s.g % (cardinality(p.cities) - 1)) % cardinality(p.cities)],
         date_trunc('hour', now()) + make_interval(days => 1 + s.g % 14, hours => 6 + s.g % 14)
    from pool p
   cross join generate_series(1, 120) s (g)
   where cardinality(p.members) > 0 and cardinality(p.drivers) > 0 and cardinality(p.cities) > 1;
$$;
comment on function kc_private.demo_ride_plan() is 'Demo restore: the 120 rides of phase "rides", by position.';

-- Restore phase "rides": publishes the planned rides with their ride rows (half free, half
-- with an expense share under the inter-city cap). Returns the number of rides created.
create or replace function kc_private.demo_seed_rides()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_created integer;
begin
  insert into public.posts (id, owner_id, world_slug, kind_id, post_type, direction, status, visibility,
                            title, description, city_id, location_display_level, source_language)
  select r.id, r.owner_id, 'rides', k.id, 'ride', r.direction, 'open', 'Public',
         case when r.direction = 'offer' then 'נוסע/ת מ' else 'מחפש/ת טרמפ מ' end
           || o.name_he || ' ל' || d.name_he,
         (array['יוצא/ת בבוקר, אפשר לעצור בדרך', 'חזרה בערב', 'יש מקום לתיק קטן', null])[1 + r.g % 4],
         r.origin_city_id, 'CityOnly', 'he'
    from kc_private.demo_ride_plan() r
    join public.cities o on o.city_id = r.origin_city_id
    join public.cities d on d.city_id = r.dest_city_id
    join lateral (select k.id from public.post_kinds k
                   where k.world_slug = 'rides' and k.is_active and k.direction in (r.direction, 'either')
                   order by k.direction = r.direction desc, k.sort_order limit 1) k on true;
  get diagnostics v_created = row_count;

  insert into public.post_ride_details (post_id, origin_city_id, dest_city_id, departs_at, arrives_at, seats,
                                        luggage, reward_model, cost_share_ils)
  select r.id, r.origin_city_id, r.dest_city_id, r.departs_at, r.departs_at + interval '90 minutes',
         case when r.direction = 'offer' then 1 + r.g % 4 else 1 end,
         r.g % 4 = 1,
         case when r.g % 2 = 0 then 'free' else 'expense_share' end,
         case when r.g % 2 = 0 then null else 10 + r.g % 40 end
    from kc_private.demo_ride_plan() r
   where exists (select 1 from public.posts p where p.id = r.id);
  return v_created;
end;
$$;
comment on function kc_private.demo_seed_rides() is
  'Demo restore phase "rides": ride offers and requests between cities, with their ride rows.';
