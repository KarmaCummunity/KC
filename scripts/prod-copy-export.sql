-- Production copy (FR-ADMIN-037) · the read of kc-prod.
--
-- Runs in the weekly job's kc-prod step (.github/workflows/prod-copy-to-dev.yml) under
-- `default_transaction_read_only = on`, and opens its own read-only snapshot as well, so it can
-- never write. It prints ONE line: a JSON document of the rows the copy may carry (AC3), with
-- production ids and production text. That line never leaves the step: the anonymizer
-- (scripts/prod-copy-anonymize.mjs) rewrites it there (AC5–AC7, AC10) and the raw file is
-- removed. What is not selected here can never reach kc-dev (AC4): no chats, contact details,
-- streets, points, photos, payments, teams, moderation, consents, surveys or audit rows.
begin transaction isolation level repeatable read read only;

with
-- Active members only: deleted, banned, suspended and unverified accounts stay out (AC4).
-- Seed accounts (tests on the reserved domain) are not members of the community.
member as (
  select u.id, u.city_id, u.biography, u.privacy_mode, u.verification_level,
         date_trunc('day', u.created_at) as created_at
    from public.users u
    join public.user_account a on a.user_id = u.id and a.status = 'active'
    join auth.users au on au.id = u.id
   where u.is_active
     and coalesce(au.email, '') not like '%@seed.kc.test'
),
-- Public posts in a published state, of the types kc-dev can rebuild alone (AC3, AC4): no
-- drafts, nothing removed or hidden by moderation, nothing for followers or the member only,
-- nothing in an organization's name, no job offers or challenge posts.
post as (
  select p.*
    from public.posts p
   where p.owner_id in (select id from member)
     and p.visibility = 'Public'
     and p.status in ('open', 'paused', 'closed_delivered', 'deleted_no_recipient', 'expired')
     and p.post_type in ('standard', 'ride', 'event', 'housing_stay')
     and p.beneficiary_org_id is null
)
select json_build_object(
  'format', 1,
  'members', coalesce((select json_agg(m) from member m), '[]'),
  -- Public fields of active organizations (D155); never the platform organization itself.
  'organizations', coalesce((
    select json_agg(json_build_object(
             'id', o.id, 'name', o.name, 'org_type', o.org_type, 'city_id', o.city_id,
             'is_verified_nonprofit', o.is_verified_nonprofit,
             'public_tagline_he', o.public_tagline_he, 'public_tagline_en', o.public_tagline_en,
             'public_about_he', o.public_about_he, 'public_about_en', o.public_about_en))
      from public.organizations o
     where o.status = 'active' and not o.is_platform), '[]'),
  'posts', coalesce((
    select json_agg(json_build_object(
             'id', p.id, 'owner_id', p.owner_id, 'world_slug', p.world_slug, 'kind_slug', k.slug,
             'item_subcategory_slug', sc.slug, 'post_type', p.post_type, 'direction', p.direction,
             'status', p.status, 'title', p.title, 'description', p.description, 'details', p.details,
             'city_id', p.city_id, 'time_window', p.time_window, 'urgency_level', p.urgency_level,
             'expires_at', p.expires_at, 'source_language', p.source_language,
             'published_at', p.published_at, 'created_at', p.created_at,
             -- Cities only: no street, junction, point or meeting place (AC4).
             'ride', (select json_build_object(
                        'origin_city_id', r.origin_city_id, 'dest_city_id', r.dest_city_id,
                        'departs_at', r.departs_at, 'arrives_at', r.arrives_at, 'seats', r.seats,
                        'luggage', r.luggage, 'cargo_items', r.cargo_items, 'cargo_food', r.cargo_food,
                        'reward_model', r.reward_model, 'cost_share_ils', r.cost_share_ils, 'notes', r.notes)
                        from public.post_ride_details r where r.post_id = p.id),
             -- No address label (AC4).
             'event', (select json_build_object(
                         'starts_at', e.starts_at, 'ends_at', e.ends_at, 'capacity', e.capacity,
                         'registration_policy', e.registration_policy,
                         'counts_volunteer_hours', e.counts_volunteer_hours)
                         from public.post_event_details e where e.post_id = p.id),
             'food', (select json_build_object(
                        'expires_at', f.expires_at, 'food_type', f.food_type, 'allergens', f.allergens,
                        'kosher', f.kosher, 'dietary_tags', f.dietary_tags)
                        from public.post_food_details f where f.post_id = p.id),
             'housing', (select json_build_object(
                           'place_type', h.place_type, 'capacity', h.capacity, 'exclusive', h.exclusive,
                           'min_nights', h.min_nights, 'max_nights', h.max_nights,
                           'check_in_from', h.check_in_from, 'check_in_until', h.check_in_until,
                           'check_out_by', h.check_out_by, 'children_ok', h.children_ok, 'pets_ok', h.pets_ok,
                           'available_from', h.available_from, 'available_until', h.available_until,
                           'available_weekdays', h.available_weekdays, 'blackout_dates', h.blackout_dates)
                           from public.post_housing_details h where h.post_id = p.id)))
      from post p
      join public.post_kinds k on k.id = p.kind_id
      left join public.item_subcategories sc on sc.id = p.item_subcategory_id
      -- kc-dev refuses a departure, a start or a food expiry in the past (AC3): not read at all.
     where not exists (select 1 from public.post_ride_details r where r.post_id = p.id and r.departs_at <= now())
       and not exists (select 1 from public.post_event_details e where e.post_id = p.id and e.starts_at <= now())
       and not exists (select 1 from public.post_food_details f where f.post_id = p.id and f.expires_at <= now())), '[]'),
  'follows', coalesce((
    select json_agg(json_build_object('follower_id', f.follower_id, 'followed_id', f.followed_id,
                                      'created_at', f.created_at))
      from public.follows f
     where f.follower_id in (select id from member) and f.followed_id in (select id from member)), '[]'),
  'saved_posts', coalesce((
    select json_agg(json_build_object('user_id', s.user_id, 'post_id', s.post_id, 'saved_at', s.saved_at))
      from public.saved_posts s
     where s.user_id in (select id from member) and s.post_id in (select id from post)), '[]'));

commit;
