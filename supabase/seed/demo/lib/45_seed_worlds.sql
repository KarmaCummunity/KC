-- Demo data (FR-ADMIN-031, #1964) · restore phase "worlds": standard posts of the food, animals,
-- knowledge and time worlds, one set per active post kind (so every kind that exists has demo
-- posts). Same rules as 40_seed_posts.sql: rows are written directly, every baseline trigger
-- still runs, and positions derive from the row number so each restore publishes the same posts.
-- Everything is owned by a demo member, so the existing wipe (posts by owner) removes it.
-- Not covered yet: housing stays and volunteering events (they need their own detail rows).

create or replace function kc_private.demo_seed_worlds()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- (world, kind slug, title, description); two posts per row.
  v_plan constant text[][] := array[
    array['food', 'food_offer', 'מרק עדשים ביתי', 'סיר גדול, אפשר לאסוף עד הערב'],
    array['food', 'food_offer', 'לחמניות מהמאפייה', 'שקית לחמניות מהיום'],
    array['food', 'food_request', 'מחפש/ת ארוחה חמה', 'למשפחה של ארבע נפשות'],
    array['animals', 'adoption_offer', 'גורת חתולים למסירה', 'מחוסנת ומאולפת לשימוש בארגז'],
    array['animals', 'adoption_request', 'מחפש/ת כלב לאימוץ', 'בית עם גינה, ניסיון קודם'],
    array['animals', 'foster_offer', 'שמירה על חתולים בחופשה', 'בבית שקט, יש ניסיון'],
    array['animals', 'foster_request', 'מחפש/ת פנסיון לכלב', 'סוף שבוע אחד'],
    array['knowledge', 'lesson_offer', 'שיעור פרטי במתמטיקה', 'חטיבת ביניים, אונליין או פנים אל פנים'],
    array['knowledge', 'mentoring_offer', 'חונכות בכתיבת קורות חיים', 'ליווי של כמה מפגשים'],
    array['knowledge', 'consulting_hour', 'שעת ייעוץ בתכנות', 'התחלה בפיתוח אתרים'],
    array['knowledge', 'learning_request', 'רוצה ללמוד גיטרה', 'מתחיל/ה לגמרי'],
    array['knowledge', 'mentoring_request', 'מחפש/ת מנטור בהייטק', 'מעבר קריירה'],
    array['knowledge', 'question', 'איך מגישים בקשה להנחת ארנונה?', 'מישהו מכיר את התהליך'],
    array['time', 'volunteer_offer', 'מתנדב/ת לעזרה בהובלות', 'ערבים וסופי שבוע'],
    array['time', 'volunteer_request', 'צריך עזרה בצביעת דירה', 'שעתיים של עבודה משותפת']];
  v_members constant uuid[] := kc_private.demo_member_ids();
  v_count constant integer := cardinality(kc_private.demo_member_ids());
  v_created integer;
begin
  if v_count = 0 then
    return 0;
  end if;

  -- Two posts per plan row; ids derive from the position so the detail rows can join them.
  insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title,
                            description, city_id, location_display_level, source_language,
                            published_at, created_at)
  select md5('kc-demo-world-' || s.g)::uuid, s.owner_id, v_plan[s.p][1], k.id, k.direction, 'open',
         case when s.g % 12 = 0 then 'OnlyMe' when s.g % 6 = 0 then 'FollowersOnly' else 'Public' end,
         v_plan[s.p][3], v_plan[s.p][4], u.city_id, 'CityOnly', 'he', s.at, s.at
    from (select g, 1 + (g - 1) % array_length(v_plan, 1) as p,
                 v_members[1 + (g * 13) % v_count] as owner_id,
                 now() - make_interval(days => g % 30, hours => g % 24) as at
            from generate_series(1, array_length(v_plan, 1) * 2) g) s
    join public.users u on u.id = s.owner_id and u.city_id is not null
    join public.post_kinds k on k.world_slug = v_plan[s.p][1] and k.slug = v_plan[s.p][2] and k.is_active
                            and k.direction in ('offer', 'request');
  get diagnostics v_created = row_count;

  -- A food offer must carry its detail row when the transaction commits.
  insert into public.post_food_details (post_id, expires_at, food_type, allergens, kosher, dietary_tags)
  select p.id, now() + make_interval(days => 1 + n % 5),
         (array['cooked', 'packaged', 'fresh', 'frozen'])[1 + n % 4], '{}', true, '{}'
    from (select p.id, (row_number() over (order by p.id))::integer as n
            from public.posts p
           where p.world_slug = 'food' and p.direction = 'offer' and p.owner_id = any (v_members)
             and not exists (select 1 from public.post_food_details d where d.post_id = p.id)) p;
  return v_created;
end;
$$;
comment on function kc_private.demo_seed_worlds() is
  'Demo restore phase "worlds": posts of every active kind in food, animals, knowledge and time.';
