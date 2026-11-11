-- 0241_worlds_and_categories | Issue #824
-- PRD_V2_NOT_FOR_MVP/donation_worlds (13 worlds), listing_kinds, categories,
-- world_links, external_bodies.

begin;

-- ── worlds ───────────────────────────────────────────────────────────────────
create table public.worlds (
  slug                      text primary key,
  prd_index                 smallint not null unique check (prd_index between 1 and 13),
  label_he                  text not null,
  label_en                  text not null,
  sensitivity               text not null default 'standard'
    check (sensitivity in ('standard', 'elevated', 'restricted')),
  requires_verification     boolean not null default false,
  default_anonymity_level   smallint not null default 3
    check (default_anonymity_level between 1 and 3),
  default_ttl_hours         integer
    check (default_ttl_hours is null or default_ttl_hours > 0),
  geo_mode                  text not null default 'local'
    check (geo_mode in ('local', 'regional', 'remote')),
  default_radius_km         numeric(8, 2) not null default 25.00
    check (default_radius_km > 0),
  geo_weight                numeric(4, 3) not null default 1.000
    check (geo_weight >= 0 and geo_weight <= 1),
  geo_decay                 numeric(8, 4) not null default 0.0500
    check (geo_decay >= 0),
  sort_order                integer not null default 0,
  is_active                 boolean not null default true,
  created_at                timestamptz not null default now()
);

comment on table public.worlds is
  'Donation worlds (PRD V2 §3.5). Anonymity: 1=operators, 2=followers, 3=public.';
comment on column public.worlds.default_ttl_hours is
  'Default listing lifetime in hours when kind/world does not override (e.g. food).';

alter table public.worlds enable row level security;
create policy worlds_select_all on public.worlds
  for select to anon, authenticated using (true);

-- ── listing kinds (per-world typed details JSON Schema) ───────────────────────
create table public.listing_kinds (
  kind_id        uuid primary key default gen_random_uuid(),
  world_slug     text not null references public.worlds(slug) on delete cascade,
  slug           text not null,
  label_he       text not null,
  label_en       text not null,
  direction      text not null check (direction in ('give', 'request', 'either')),
  detail_schema  jsonb not null default '{"type":"object"}'::jsonb,
  default_ttl_hours integer check (default_ttl_hours is null or default_ttl_hours > 0),
  sort_order     integer not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  constraint listing_kinds_world_slug_unique unique (world_slug, slug)
);

create index listing_kinds_world_idx on public.listing_kinds (world_slug, sort_order);

alter table public.listing_kinds enable row level security;
create policy listing_kinds_select_all on public.listing_kinds
  for select to anon, authenticated using (true);

-- ── categories (tree per world) ─────────────────────────────────────────────
create table public.categories (
  category_id              uuid primary key default gen_random_uuid(),
  world_slug               text not null references public.worlds(slug) on delete cascade,
  parent_id                uuid references public.categories(category_id) on delete cascade,
  slug                     text not null,
  label_he                 text not null,
  label_en                 text,
  sort_order               integer not null default 0,
  is_active                boolean not null default true,
  legacy_post_category     text,
  legacy_donation_slug     text references public.donation_categories(slug),
  created_at               timestamptz not null default now(),
  constraint categories_world_slug_unique unique (world_slug, slug)
);

create index categories_world_parent_idx
  on public.categories (world_slug, parent_id, sort_order);

alter table public.categories enable row level security;
create policy categories_select_all on public.categories
  for select to anon, authenticated using (true);

create or replace function public.categories_enforce_parent_world()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_parent_world text;
begin
  if new.parent_id is null then
    return new;
  end if;
  select world_slug into v_parent_world from public.categories where category_id = new.parent_id;
  if v_parent_world is null then
    raise exception 'categories_parent_missing' using errcode = '23503';
  end if;
  if v_parent_world is distinct from new.world_slug then
    raise exception 'categories_parent_world_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger categories_parent_world_trg
  before insert or update of parent_id, world_slug on public.categories
  for each row execute function public.categories_enforce_parent_world();

-- ── cross-world links (PRD integrations) ─────────────────────────────────────
create table public.world_links (
  link_id          uuid primary key default gen_random_uuid(),
  from_world_slug  text not null references public.worlds(slug) on delete cascade,
  to_world_slug    text not null references public.worlds(slug) on delete cascade,
  link_slug        text not null,
  label_he         text not null,
  label_en         text not null,
  description      text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  constraint world_links_slug_unique unique (from_world_slug, link_slug),
  constraint world_links_not_self check (from_world_slug <> to_world_slug)
);

alter table public.world_links enable row level security;
create policy world_links_select_all on public.world_links
  for select to anon, authenticated using (true);

-- ── external bodies (medical / regulated routing — never direct P2P) ─────────
create table public.external_bodies (
  body_id            uuid primary key default gen_random_uuid(),
  slug               text not null unique,
  world_slug         text not null references public.worlds(slug) on delete cascade,
  label_he           text not null,
  label_en           text not null,
  body_type          text not null check (body_type in (
    'blood_services', 'organ_registry', 'hospital', 'ngo', 'government', 'recycling', 'other'
  )),
  requires_routing   boolean not null default true,
  contact_url        text check (contact_url is null or contact_url ~* '^https?://'),
  is_verified        boolean not null default false,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);

alter table public.external_bodies enable row level security;
create policy external_bodies_select_all on public.external_bodies
  for select to anon, authenticated using (true);

-- ── anonymity ↔ legacy visibility helpers ───────────────────────────────────
create or replace function public.anonymity_level_to_visibility(p_level integer)
returns text
language sql
immutable
parallel safe
as $$
  select case p_level
    when 1 then 'OnlyMe'
    when 2 then 'FollowersOnly'
    else 'Public'
  end;
$$;

create or replace function public.visibility_to_anonymity_level(p_visibility text)
returns smallint
language sql
immutable
parallel safe
as $$
  select case p_visibility
    when 'OnlyMe' then 1::smallint
    when 'FollowersOnly' then 2::smallint
    else 3::smallint
  end;
$$;

grant execute on function public.anonymity_level_to_visibility(integer) to anon, authenticated;
grant execute on function public.visibility_to_anonymity_level(text) to anon, authenticated;

-- ── seed worlds (PRD donation_worlds 01–13) ───────────────────────────────────
insert into public.worlds (
  slug, prd_index, label_he, label_en, sensitivity, requires_verification,
  default_anonymity_level, default_ttl_hours, geo_mode,
  default_radius_km, geo_weight, geo_decay, sort_order
) values
  ('money',               1,  'כסף',           'Money',               'standard',   false, 3, null,  'remote',   500.00, 0.100, 0.0000,  1),
  ('items',               2,  'חפצים',         'Items',               'standard',   false, 3, null,  'local',     25.00, 1.000, 0.0500,  2),
  ('food',                3,  'מזון',          'Food',                'standard',   false, 3, 168,   'local',     15.00, 1.000, 0.0800,  3),
  ('medical',             4,  'רפואה',         'Medical',             'restricted', true,  2, null,  'regional', 120.00, 0.750, 0.0400,  4),
  ('housing',             5,  'דיור',          'Housing',             'elevated',   true,  2, null,  'regional',  80.00, 0.850, 0.0450,  5),
  ('rides',               6,  'נסיעות',        'Rides',               'standard',   false, 3, 72,    'regional', 100.00, 0.900, 0.0500,  6),
  ('knowledge',           7,  'ידע',           'Knowledge',           'standard',   true,  3, null,  'remote',   500.00, 0.200, 0.0000,  7),
  ('time',                8,  'זמן',           'Time',                'standard',   false, 2, null,  'remote',    50.00, 0.500, 0.0200,  8),
  ('animals',             9,  'חיות',          'Animals',             'elevated',   true,  3, null,  'local',     30.00, 1.000, 0.0600,  9),
  ('environment',        10,  'סביבה',         'Environment',         'standard',   false, 3, null,  'local',     40.00, 0.900, 0.0500, 10),
  ('creative',           11,  'יצירה',         'Creative',            'standard',   true,  3, null,  'remote',   500.00, 0.150, 0.0000, 11),
  ('romantic_matchmaking',12, 'שידוכים',       'Romantic matchmaking','restricted', true,  1, null,  'remote',   200.00, 0.050, 0.0000, 12),
  ('app_design',         13,  'עיצוב האפליקציה','App design',         'standard',   false, 3, null,  'remote',   500.00, 0.000, 0.0000, 13)
on conflict (slug) do nothing;

-- ── listing kinds (representative set per PRD §2–4) ─────────────────────────
insert into public.listing_kinds (world_slug, slug, label_he, label_en, direction, detail_schema, default_ttl_hours, sort_order)
values
  ('items', 'give_item', 'מסירת חפץ', 'Give item', 'give',
   '{"type":"object","properties":{"item_condition":{"enum":["New","LikeNew","Good","Fair"]},"fulfillment_mode":{"enum":["fcfs","owner_approval"]},"needs_transport":{"type":"boolean"},"weight_kg":{"type":"number"},"dimensions_cm":{"type":"string"}}}'::jsonb,
   null, 1),
  ('items', 'request_item', 'בקשת חפץ', 'Request item', 'request',
   '{"type":"object","properties":{"min_condition":{"type":"string"},"urgency_note":{"type":"string"}}}'::jsonb,
   null, 2),
  ('food', 'give_food', 'חלוקת מזון', 'Give food', 'give',
   '{"type":"object","required":["expires_at","food_type"],"properties":{"food_type":{"enum":["cooked","packaged","fresh","frozen","dry","beverage"]},"expires_at":{"type":"string","format":"date-time"},"allergens":{"type":"array","items":{"type":"string"}},"kosher":{"type":"string"},"dietary_tags":{"type":"array","items":{"type":"string"}},"fulfillment_mode":{"enum":["fcfs","owner_approval"]}}}'::jsonb,
   168, 1),
  ('food', 'request_food', 'בקשת מזון', 'Request food', 'request',
   '{"type":"object","properties":{"household_size":{"type":"integer"},"dietary_needs":{"type":"string"}}}'::jsonb,
   null, 2),
  ('medical', 'blood_appointment', 'תיאום תרומת דם', 'Blood donation appointment', 'give',
   '{"type":"object","properties":{"blood_type":{"type":"string"},"appointment_at":{"type":"string","format":"date-time"},"health_declaration_ack":{"type":"boolean"}}}'::jsonb,
   null, 1),
  ('medical', 'adi_registration', 'רישום אדי', 'ADI organ registry', 'give',
   '{"type":"object","properties":{"organs_selected":{"type":"array","items":{"type":"string"}},"legal_ack":{"type":"boolean"},"signature_ref":{"type":"string"}}}'::jsonb,
   null, 2),
  ('medical', 'living_donation_intent', 'תרומה בחיים', 'Living donation intent', 'give',
   '{"type":"object","properties":{"donation_type":{"enum":["kidney","bone_marrow","plasma","breast_milk","hair"]},"partner_body_slug":{"type":"string"}}}'::jsonb,
   null, 3),
  ('medical', 'equipment_give', 'ציוד רפואי למסירה', 'Medical equipment give', 'give',
   '{"type":"object","properties":{"equipment_type":{"type":"string"},"clinical_ok":{"enum":["yes","no","unknown"]},"cross_list_items":{"type":"boolean"}}}'::jsonb,
   null, 4),
  ('medical', 'equipment_request', 'בקשת ציוד רפואי', 'Medical equipment request', 'request',
   '{"type":"object","properties":{"equipment_type":{"type":"string"},"urgency":{"type":"string"}}}'::jsonb,
   null, 5),
  ('medical', 'escort_request', 'בקשת ליווי רפואי', 'Medical escort request', 'request',
   '{"type":"object","properties":{"appointment_at":{"type":"string","format":"date-time"},"facility_name":{"type":"string"},"needs_blue_badge":{"type":"boolean"}}}'::jsonb,
   null, 6),
  ('medical', 'blood_urgency_org', 'קריאת דם דחופה (גוף)', 'Urgent blood call (org)', 'give',
   '{"type":"object","required":["blood_type"],"properties":{"blood_type":{"type":"string"},"radius_km":{"type":"number"}}}'::jsonb,
   24, 7),
  ('housing', 'host_offer', 'הצעת אירוח', 'Hosting offer', 'give',
   '{"type":"object","properties":{"hosting_model":{"enum":["recurring_slot","open_spot","continuous"]},"place_type":{"type":"string"},"capacity":{"type":"integer"},"amenities":{"type":"array","items":{"type":"string"}},"house_rules":{"type":"string"}}}'::jsonb,
   null, 1),
  ('housing', 'stay_request', 'בקשת אירוח', 'Stay request', 'request',
   '{"type":"object","properties":{"guest_scenario":{"enum":["trail","homeless_emergency","regular"]},"party_size":{"type":"integer"},"gear":{"type":"string"}}}'::jsonb,
   null, 2),
  ('rides', 'ride_offer', 'הצעת נסיעה', 'Ride offer', 'give',
   '{"type":"object","properties":{"seats_available":{"type":"integer"},"cargo_items":{"type":"boolean"},"cargo_food":{"type":"boolean"},"reward_model":{"enum":["free","expense_share"]},"linked_listing_id":{"type":"string","format":"uuid"}}}'::jsonb,
   72, 1),
  ('rides', 'ride_request', 'בקשת נסיעה', 'Ride request', 'request',
   '{"type":"object","properties":{"passengers":{"type":"integer"},"luggage":{"type":"boolean"},"constraints":{"type":"string"}}}'::jsonb,
   72, 2),
  ('money', 'donate', 'תרומה', 'Donate', 'give',
   '{"type":"object","properties":{"amount_ils":{"type":"number"},"recurrence":{"enum":["once","monthly","quarterly","yearly"]},"target_org_slug":{"type":"string"},"receipt_requested":{"type":"boolean"}}}'::jsonb,
   null, 1),
  ('money', 'financial_aid_request', 'בקשת סיוע כספי', 'Financial aid request', 'request',
   '{"type":"object","properties":{"need_summary":{"type":"string"},"amount_requested_ils":{"type":"number"}}}'::jsonb,
   null, 2),
  ('knowledge', 'course', 'קורס', 'Course', 'give',
   '{"type":"object","properties":{"level":{"enum":["beginner","intermediate","advanced"]},"topic_slug":{"type":"string"},"requires_org_approval":{"type":"boolean","const":true}}}'::jsonb,
   null, 1),
  ('knowledge', 'private_lesson', 'שיעור פרטי', 'Private lesson', 'give',
   '{"type":"object","properties":{"modality":{"enum":["in_person","video","phone"]},"availability_note":{"type":"string"}}}'::jsonb,
   null, 2),
  ('knowledge', 'mentorship_request', 'בקשת חונכות', 'Mentorship request', 'request',
   '{"type":"object","properties":{"topic_slug":{"type":"string"},"level":{"type":"string"}}}'::jsonb,
   null, 3),
  ('time', 'volunteer_shift', 'משמרת התנדבות', 'Volunteer shift', 'give',
   '{"type":"object","properties":{"duration_minutes":{"type":"integer"},"skills":{"type":"array","items":{"type":"string"}},"org_host_slug":{"type":"string"}}}'::jsonb,
   null, 1),
  ('time', 'support_request', 'בקשת סיוע אנושי', 'Human support request', 'request',
   '{"type":"object","properties":{"support_type":{"enum":["emotional","companionship","practical","escort"]},"duration_minutes":{"type":"integer"}}}'::jsonb,
   null, 2),
  ('animals', 'adoption_offer', 'הצעת אימוץ', 'Adoption offer', 'give',
   '{"type":"object","properties":{"species":{"type":"string"},"requires_ngo_routing":{"type":"boolean","const":true},"vaccinated":{"type":"boolean"}}}'::jsonb,
   null, 1),
  ('animals', 'foster_offer', 'פנסיון זמני', 'Foster offer', 'give',
   '{"type":"object","properties":{"species":{"type":"string"},"duration_days":{"type":"integer"}}}'::jsonb,
   null, 2),
  ('environment', 'plant_give', 'חלוקת צמחים', 'Plant give', 'give',
   '{"type":"object","properties":{"plant_health":{"type":"string"},"quantity":{"type":"integer"}}}'::jsonb,
   null, 1),
  ('environment', 'recycling_give', 'מיחזור למסירה', 'Recycling give', 'give',
   '{"type":"object","properties":{"waste_type":{"enum":["e_waste","plastic","hazardous","garden_tool"]},"requires_verified_body":{"type":"boolean"}}}'::jsonb,
   null, 2),
  ('creative', 'recipe', 'מתכון', 'Recipe', 'give',
   '{"type":"object","properties":{"dietary_tags":{"type":"array","items":{"type":"string"}},"difficulty":{"type":"string"}}}'::jsonb,
   null, 1),
  ('creative', 'music_offer', 'מוזיקה / ליווי', 'Music offer', 'give',
   '{"type":"object","properties":{"event_type":{"type":"string"},"instrument":{"type":"string"}}}'::jsonb,
   null, 2),
  ('romantic_matchmaking', 'matchmaker_offer', 'שירות שדכנות', 'Matchmaker offer', 'give',
   '{"type":"object","properties":{"communities_served":{"type":"array","items":{"type":"string"}},"requires_blue_badge":{"type":"boolean","const":true}}}'::jsonb,
   null, 1),
  ('romantic_matchmaking', 'seeker_profile', 'פרופיל מחפש/ת', 'Seeker profile', 'request',
   '{"type":"object","properties":{"age_min":{"type":"integer"},"age_max":{"type":"integer"},"values_note":{"type":"string"}}}'::jsonb,
   null, 2),
  ('app_design', 'theme_share', 'שיתוף ערכת עיצוב', 'Theme share', 'give',
   '{"type":"object","required":["theme_tokens"],"properties":{"theme_tokens":{"type":"object"},"tags":{"type":"array","items":{"type":"string"}},"contrast_check_passed":{"type":"boolean"}}}'::jsonb,
   null, 1)
on conflict (world_slug, slug) do nothing;

-- ── world links ───────────────────────────────────────────────────────────────
insert into public.world_links (from_world_slug, to_world_slug, link_slug, label_he, label_en)
values
  ('items', 'rides', 'needs_transport', 'חפץ דורש שינוע', 'Item needs a ride'),
  ('items', 'medical', 'medical_equipment_cross', 'ציוד רפואי יד שנייה', 'Second-hand medical equipment'),
  ('food', 'rides', 'urgent_food_transport', 'שינוע מזון דחוף', 'Urgent food transport'),
  ('housing', 'rides', 'ride_to_host', 'נסיעה לאירוח', 'Ride to hosting'),
  ('medical', 'rides', 'medical_ride', 'נסיעה רפואית', 'Medical ride'),
  ('creative', 'items', 'instrument_as_item', 'כלי נגינה כחפץ', 'Instrument as item'),
  ('creative', 'food', 'recipe_to_food', 'מתכון → חלוקת מזון', 'Recipe to food sharing'),
  ('creative', 'knowledge', 'lesson_as_knowledge', 'שיעור כידע', 'Lesson as knowledge'),
  ('animals', 'items', 'pet_gear', 'ציוד לחיות', 'Pet gear (items)'),
  ('animals', 'food', 'pet_food', 'מזון לחיות', 'Pet food'),
  ('animals', 'time', 'shelter_volunteering', 'התנדבות במקלט', 'Shelter volunteering'),
  ('environment', 'items', 'garden_tools', 'כלי גינון', 'Garden tools (items)')
on conflict (from_world_slug, link_slug) do nothing;

-- ── external bodies ─────────────────────────────────────────────────────────
insert into public.external_bodies (slug, world_slug, label_he, label_en, body_type, requires_routing, is_verified)
values
  ('mda', 'medical', 'מגן דוד אדום', 'Magen David Adom', 'blood_services', true, true),
  ('adi', 'medical', 'אדי — איגוד להתנדבות', 'ADI organ registry', 'organ_registry', true, true),
  ('ezer_lamaret', 'medical', 'עזר מלרת', 'Ezer Lamaret', 'ngo', true, true),
  ('yad_sarah', 'medical', 'יד שרה', 'Yad Sarah', 'ngo', true, true),
  ('ezra_lemaret_bone_marrow', 'medical', 'עזר מציון — מח עצם', 'Ezer Mizion bone marrow', 'ngo', true, true),
  ('health_ministry_hazardous', 'environment', 'משרד הבריאות — פסולת מסוכנת', 'Health ministry hazardous waste', 'government', true, true),
  ('municipal_ewaste', 'environment', 'רשות מקומית — אלקטרוניקה', 'Municipal e-waste', 'government', true, false)
on conflict (slug) do nothing;

-- ── categories: roots + PRD trees (abbreviated) ─────────────────────────────
insert into public.categories (world_slug, slug, label_he, label_en, sort_order)
values ('items', 'items', 'חפצים', 'Items', 0)
on conflict (world_slug, slug) do nothing;

insert into public.categories (world_slug, parent_id, slug, label_he, label_en, sort_order, legacy_post_category)
select 'items', p.category_id, v.slug, v.label_he, v.label_en, v.ord, v.legacy
from public.categories p
cross join (values
  ('furniture', 'רהיטים', 'Furniture', 1, 'Furniture'),
  ('clothing', 'בגדים', 'Clothing', 2, 'Clothing'),
  ('books', 'ספרים', 'Books', 3, 'Books'),
  ('toys', 'משחקים', 'Toys', 4, 'Toys'),
  ('baby-gear', 'ציוד תינוקות', 'BabyGear', 5, 'BabyGear'),
  ('kitchen', 'מטבח', 'Kitchen', 6, 'Kitchen'),
  ('sports', 'ספורט', 'Sports', 7, 'Sports'),
  ('electronics', 'חשמל', 'Electronics', 8, 'Electronics'),
  ('tools', 'כלי עבודה', 'Tools', 9, 'Tools'),
  ('medical-second-hand', 'רפואי יד שנייה', 'Medical second-hand', 10, null),
  ('other', 'אחר', 'Other', 11, 'Other')
) as v(slug, label_he, label_en, ord, legacy)
where p.world_slug = 'items' and p.slug = 'items'
on conflict (world_slug, slug) do nothing;

insert into public.categories (world_slug, slug, label_he, label_en, sort_order, legacy_donation_slug)
select
  case dc.slug when 'transport' then 'rides' when 'housing' then 'housing' else dc.slug end,
  dc.slug, dc.label_he, dc.slug, dc.sort_order, dc.slug
from public.donation_categories dc where dc.is_active
on conflict (world_slug, slug) do nothing;

-- Medical subcategories (PRD §3)
insert into public.categories (world_slug, parent_id, slug, label_he, label_en, sort_order)
select 'medical', p.category_id, v.slug, v.label_he, v.label_en, v.ord
from public.categories p
cross join (values
  ('blood', 'תרומת דם', 'Blood', 1),
  ('organs-adi', 'תרומת אברים (אדי)', 'Organ (ADI)', 2),
  ('living-donation', 'תרומה בחיים', 'Living donation', 3),
  ('usable-equipment', 'ציוד רפואי שמיש', 'Usable equipment', 4),
  ('medical-escort', 'ליווי רפואי', 'Medical escort', 5),
  ('financial-medical', 'תרומה כספית רפואית', 'Financial (via money world)', 6)
) as v(slug, label_he, label_en, ord)
where p.world_slug = 'medical' and p.slug = 'medical'
on conflict (world_slug, slug) do nothing;

-- Food (PRD 03_Food §3)
insert into public.categories (world_slug, parent_id, slug, label_he, label_en, sort_order)
select 'food', p.category_id, v.slug, v.label_he, v.label_en, v.ord
from public.categories p
cross join (values
  ('cooked-ready', 'מבושל מוכן', 'Cooked ready', 1),
  ('fresh-raw', 'טרי לא מבושל', 'Fresh raw', 2),
  ('packaged', 'ארוז וסגור', 'Packaged', 3),
  ('frozen', 'קפוא', 'Frozen', 4),
  ('beverages', 'שתייה', 'Beverages', 5),
  ('dry-goods', 'יבש', 'Dry goods', 6),
  ('bakery', 'מאפים', 'Bakery', 7),
  ('catering', 'קייטרינג / אירוע', 'Catering', 8),
  ('org-food-drive', 'תרומה ארגונית', 'Org food drive', 9)
) as v(slug, label_he, label_en, ord)
where p.world_slug = 'food' and p.slug = 'food'
on conflict (world_slug, slug) do nothing;

-- Housing (PRD 05_Housing §3)
insert into public.categories (world_slug, parent_id, slug, label_he, label_en, sort_order)
select 'housing', p.category_id, v.slug, v.label_he, v.label_en, v.ord
from public.categories p
cross join (values
  ('family-room', 'חדר במשפחה', 'Family room', 1),
  ('whole-unit', 'דירה שלמה', 'Whole unit', 2),
  ('sofa', 'ספה / סלון', 'Sofa', 3),
  ('outdoor', 'שטח חיצוני', 'Outdoor', 4),
  ('secondary-unit', 'בקתה / מבנה משני', 'Secondary unit', 5),
  ('emergency', 'חירום / זמני', 'Emergency', 6)
) as v(slug, label_he, label_en, ord)
where p.world_slug = 'housing' and p.slug = 'housing'
on conflict (world_slug, slug) do nothing;

-- Rides (PRD 06_Rides §3)
insert into public.categories (world_slug, parent_id, slug, label_he, label_en, sort_order)
select 'rides', p.category_id, v.slug, v.label_he, v.label_en, v.ord
from public.categories p
cross join (values
  ('intercity', 'בין-עירונית', 'Intercity', 1),
  ('intracity', 'תוך-עירונית', 'Intracity', 2),
  ('multi-stop', 'מסעדן', 'Multi-stop', 3),
  ('emergency', 'חירום', 'Emergency', 4),
  ('org-shuttle', 'ארגונית', 'Organizational', 5),
  ('commute-recurring', 'יומיומית קבועה', 'Recurring commute', 6)
) as v(slug, label_he, label_en, ord)
where p.world_slug = 'rides' and p.slug = 'transport'
on conflict (world_slug, slug) do nothing;

-- Knowledge (PRD 07_Knowledge §3)
insert into public.categories (world_slug, parent_id, slug, label_he, label_en, sort_order)
select 'knowledge', p.category_id, v.slug, v.label_he, v.label_en, v.ord
from public.categories p
cross join (values
  ('tech', 'תכנות וטכנולוגיה', 'Tech', 1),
  ('languages', 'שפות', 'Languages', 2),
  ('stem', 'מתמטיקה ומדעים', 'STEM', 3),
  ('professional', 'אקדמיה ומקצוע', 'Professional', 4),
  ('arts', 'אומנויות', 'Arts', 5),
  ('life-skills', 'כישורי חיים', 'Life skills', 6),
  ('parenting', 'הורות וחינוך', 'Parenting', 7)
) as v(slug, label_he, label_en, ord)
where p.world_slug = 'knowledge' and p.slug = 'knowledge'
on conflict (world_slug, slug) do nothing;

-- Time (PRD 08_Time §3)
insert into public.categories (world_slug, parent_id, slug, label_he, label_en, sort_order)
select 'time', p.category_id, v.slug, v.label_he, v.label_en, v.ord
from public.categories p
cross join (values
  ('emotional-support', 'תמיכה רגשית', 'Emotional support', 1),
  ('seniors', 'גיל הזהב', 'Seniors', 2),
  ('mentoring', 'חינוך וחונכות', 'Mentoring', 3),
  ('tech-help', 'טכנולוגיה', 'Tech help', 4),
  ('community', 'קהילה ושכונה', 'Community', 5),
  ('animals-volunteer', 'בעלי חיים', 'Animals volunteer', 6)
) as v(slug, label_he, label_en, ord)
where p.world_slug = 'time' and p.slug = 'time'
on conflict (world_slug, slug) do nothing;

-- Animals (PRD 09_Animals §3)
insert into public.categories (world_slug, parent_id, slug, label_he, label_en, sort_order)
select 'animals', p.category_id, v.slug, v.label_he, v.label_en, v.ord
from public.categories p
cross join (values
  ('dogs', 'כלבים', 'Dogs', 1),
  ('cats', 'חתולים', 'Cats', 2),
  ('exotic', 'חיות אקזוטיות', 'Exotic', 3),
  ('farm', 'משקיים', 'Farm', 4),
  ('lost-found', 'חיות אבודות', 'Lost & found', 5)
) as v(slug, label_he, label_en, ord)
where p.world_slug = 'animals' and p.slug = 'animals'
on conflict (world_slug, slug) do nothing;

-- Roots without legacy donation_categories row
insert into public.categories (world_slug, slug, label_he, label_en, sort_order)
values
  ('environment', 'environment', 'סביבה', 'Environment', 0),
  ('creative', 'creative', 'יצירה', 'Creative', 0),
  ('app_design', 'app_design', 'עיצוב', 'App design', 0),
  ('romantic_matchmaking', 'romantic_matchmaking', 'שידוכים', 'Matchmaking', 0)
on conflict (world_slug, slug) do nothing;

-- Environment (PRD 10_Environment §3)
insert into public.categories (world_slug, parent_id, slug, label_he, label_en, sort_order)
select 'environment', p.category_id, v.slug, v.label_he, v.label_en, v.ord
from public.categories p
cross join (values
  ('houseplants', 'צמחי בית', 'Houseplants', 1),
  ('garden', 'צמחי גינה', 'Garden', 2),
  ('cuttings-seeds', 'ייחורים וזרעים', 'Cuttings & seeds', 3),
  ('community-garden', 'גינון קהילתי', 'Community garden', 4),
  ('e-waste', 'פסולת אלקטרונית', 'E-waste', 5),
  ('recyclables', 'מיחזור', 'Recyclables', 6),
  ('hazardous', 'פסולת מסוכנת', 'Hazardous', 7)
) as v(slug, label_he, label_en, ord)
where p.world_slug = 'environment' and p.slug = 'environment'
on conflict (world_slug, slug) do nothing;

-- Creative (PRD 11_Creative §3)
insert into public.categories (world_slug, parent_id, slug, label_he, label_en, sort_order)
select 'creative', p.category_id, v.slug, v.label_he, v.label_en, v.ord
from public.categories p
cross join (values
  ('music-instrument', 'כלי נגינה', 'Instrument', 1),
  ('music-gig', 'ליווי בנגינה', 'Music gig', 2),
  ('recipes', 'מתכונים', 'Recipes', 3),
  ('puzzles', 'חידות', 'Puzzles', 4)
) as v(slug, label_he, label_en, ord)
where p.world_slug = 'creative' and p.slug = 'creative'
on conflict (world_slug, slug) do nothing;

commit;


