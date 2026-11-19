-- Production copy tools of kc-dev (FR-ADMIN-037, supabase/seed/prod-copy): the dev marker and
-- the format check, what a copy creates (active members who cannot sign in, city-only posts
-- with their world rows, organizations, follows, saves), the posts kc-dev refuses being
-- skipped and counted, a second run changing nothing, changes and deletions in production
-- followed, kc-dev's own data never touched, and "Delete copied data".
-- The tools are a dev-only seed, not a migration, so this test installs them itself.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local client_min_messages = warning;

-- The platform's auth tables carry more than the local shim (as in 110_demo_data.sql).
alter table auth.users
  add column if not exists instance_id uuid, add column if not exists aud text,
  add column if not exists role text, add column if not exists encrypted_password text,
  add column if not exists updated_at timestamptz, add column if not exists confirmation_token text,
  add column if not exists recovery_token text, add column if not exists email_change_token_new text,
  add column if not exists email_change text;
create table if not exists auth.identities (
  id uuid primary key, user_id uuid not null references auth.users (id) on delete cascade,
  provider_id text not null, identity_data jsonb not null, provider text not null,
  last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);

-- Installed twice: the second run must succeed and change nothing.
\ir ../seed/prod-copy/install.sql
\ir ../seed/prod-copy/install.sql

select plan(20);

-- Ids: copied members m1…m3, copied posts p1…p9, a copied organization; t is a kc-dev tester.
create function pg_temp.id(p_key text)
returns uuid
language sql
as $$ select md5('prod-copy-test-' || p_key)::uuid; $$;

-- Runs a statement and returns 'ok', or the P0001 message / the SQLSTATE of its error.
create function pg_temp.try(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
end;
$$;

-- Reference data the copy places its content in.
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)'),
  ('c2', 'c2', 'City Two', 'SRID=4326;POINT(35.21 31.77)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'Items'),
  ('rides', 'rides', 'Rides'), ('food', 'food', 'Food'), ('housing', 'housing', 'Housing')
  on conflict (slug) do nothing;
insert into public.post_kinds (world_slug, slug, label_he, label_en, direction) values
  ('items', 'item_offer', 'o', 'o', 'offer'), ('items', 'item_request', 'r', 'r', 'request'),
  ('rides', 'ride_offer', 'o', 'o', 'offer'), ('food', 'food_offer', 'o', 'o', 'offer'),
  ('housing', 'stay_offer', 'o', 'o', 'offer')
  on conflict do nothing;
insert into public.item_subcategories (world_slug, slug, label_he, label_en) values ('items', 'furniture', 'f', 'Furniture')
  on conflict do nothing;

-- kc-dev's own data: a tester (a real kc-dev account), a demo member and an e2e member.
insert into auth.users (id, email, raw_app_meta_data, email_confirmed_at) values
  (pg_temp.id('t'), 't@example.test', '{"provider":"google"}', now()),
  (pg_temp.id('d'), 'demo1@seed.kc.test', '{"provider":"email","demo":true}', now()),
  (pg_temp.id('e'), 'user1@seed.kc.test', '{"provider":"email","seed":true}', now());

-- One copy document. `p_variant` 'changed' is the next week's production: m1 renamed, p1
-- retitled, p2 and m3 (with p6) gone, the m2 → m1 follow gone.
create function pg_temp.copy(p_variant text default 'first')
returns jsonb
language sql
as $$
  with v as (select p_variant = 'changed' as ch)
  select jsonb_build_object(
    'format', 1,
    'members', (select jsonb_agg(m) from v, lateral (values
        (jsonb_build_object('id', pg_temp.id('m1'), 'email', 'prodcopy-aaaa@seed.kc.test',
           'display_name', case when v.ch then 'נועה כהן' else 'דנה לוי' end, 'city_id', 'c1',
           'biography', 'אוהבת לעזור [הוסר]', 'privacy_mode', 'Public', 'verification_level', 1)),
        (jsonb_build_object('id', pg_temp.id('m2'), 'email', 'prodcopy-bbbb@seed.kc.test',
           'display_name', 'יוסי פרץ', 'city_id', 'c2', 'privacy_mode', 'Public', 'verification_level', 0)),
        (case when not v.ch then jsonb_build_object('id', pg_temp.id('m3'), 'email', 'prodcopy-cccc@seed.kc.test',
           'display_name', 'רון גולן', 'city_id', 'c1', 'privacy_mode', 'Private', 'verification_level', 0) end)
      ) x (m) where m is not null),
    'organizations', jsonb_build_array(jsonb_build_object('id', pg_temp.id('o1'), 'name', 'עמותה לדוגמה',
      'org_type', 'nonprofit_association', 'city_id', 'c1', 'public_tagline_he', 'עוזרים לכולם')),
    'posts', (select jsonb_agg(p) from v, lateral (values
        (jsonb_build_object('id', pg_temp.id('p1'), 'owner_id', pg_temp.id('m1'), 'world_slug', 'items',
           'kind_slug', 'item_offer', 'item_subcategory_slug', 'furniture', 'post_type', 'standard',
           'direction', 'offer', 'status', 'open', 'title', case when v.ch then 'ספה ושולחן' else 'ספה' end,
           'description', 'במצב טוב', 'city_id', 'c1', 'source_language', 'he')),
        (case when not v.ch then jsonb_build_object('id', pg_temp.id('p2'), 'owner_id', pg_temp.id('m1'),
           'world_slug', 'items', 'kind_slug', 'item_request', 'post_type', 'standard', 'direction', 'request',
           'status', 'closed_delivered', 'title', 'מחפשת מקרר', 'city_id', 'c1') end),
        (jsonb_build_object('id', pg_temp.id('p3'), 'owner_id', pg_temp.id('m2'), 'world_slug', 'rides',
           'kind_slug', 'ride_offer', 'post_type', 'ride', 'direction', 'offer', 'status', 'open',
           'title', 'נוסע לעיר שתיים', 'city_id', 'c1',
           'ride', jsonb_build_object('origin_city_id', 'c1', 'dest_city_id', 'c2', 'seats', 3,
             'departs_at', date_trunc('hour', now()) + interval '2 days',
             'arrives_at', date_trunc('hour', now()) + interval '2 days 1 hour', 'reward_model', 'free'))),
        -- Departed already: kc-dev refuses a past departure, so the copy skips it.
        (jsonb_build_object('id', pg_temp.id('p4'), 'owner_id', pg_temp.id('m2'), 'world_slug', 'rides',
           'kind_slug', 'ride_offer', 'post_type', 'ride', 'direction', 'offer', 'status', 'open',
           'title', 'נסיעה שעברה', 'city_id', 'c1',
           'ride', jsonb_build_object('origin_city_id', 'c1', 'dest_city_id', 'c2', 'seats', 2,
             'departs_at', now() - interval '2 days', 'arrives_at', now() - interval '47 hours',
             'reward_model', 'free'))),
        (jsonb_build_object('id', pg_temp.id('p5'), 'owner_id', pg_temp.id('m2'), 'world_slug', 'food',
           'kind_slug', 'food_offer', 'post_type', 'standard', 'direction', 'offer', 'status', 'open',
           'title', 'עוגה', 'city_id', 'c2',
           'food', jsonb_build_object('expires_at', now() + interval '1 day', 'allergens', '["gluten"]'::jsonb,
             'dietary_tags', '[]'::jsonb, 'kosher', true))),
        (case when not v.ch then jsonb_build_object('id', pg_temp.id('p6'), 'owner_id', pg_temp.id('m3'),
           'world_slug', 'items', 'kind_slug', 'item_offer', 'post_type', 'standard', 'direction', 'offer',
           'status', 'open', 'title', 'ספרים', 'city_id', 'c1') end),
        (jsonb_build_object('id', pg_temp.id('p9'), 'owner_id', pg_temp.id('m1'), 'world_slug', 'housing',
           'kind_slug', 'stay_offer', 'post_type', 'housing_stay', 'direction', 'offer', 'status', 'open',
           'title', 'חדר פנוי', 'city_id', 'c1',
           'housing', jsonb_build_object('place_type', 'private_room', 'capacity', 2, 'exclusive', true,
             'min_nights', 1, 'max_nights', 3, 'check_in_from', '16:00', 'check_in_until', '22:00',
             'check_out_by', '10:00', 'children_ok', true, 'pets_ok', false,
             'available_until', current_date + 30, 'blackout_dates', '[]'::jsonb))),
        -- A kind kc-dev does not have.
        (jsonb_build_object('id', pg_temp.id('p7'), 'owner_id', pg_temp.id('m1'), 'world_slug', 'items',
           'kind_slug', 'no_such_kind', 'post_type', 'standard', 'direction', 'offer', 'status', 'open',
           'title', 'x', 'city_id', 'c1')),
        -- The owner is not in the copy: never written.
        (jsonb_build_object('id', pg_temp.id('p8'), 'owner_id', pg_temp.id('t'), 'world_slug', 'items',
           'kind_slug', 'item_offer', 'post_type', 'standard', 'direction', 'offer', 'status', 'open',
           'title', 'not mine', 'city_id', 'c1'))
      ) x (p) where p is not null),
    'follows', (select jsonb_agg(f) from v, lateral (values
        (jsonb_build_object('follower_id', pg_temp.id('m1'), 'followed_id', pg_temp.id('m2'))),
        (case when not v.ch then jsonb_build_object('follower_id', pg_temp.id('m2'), 'followed_id', pg_temp.id('m1')) end)
      ) x (f) where f is not null),
    'saved_posts', jsonb_build_array(
        jsonb_build_object('user_id', pg_temp.id('m1'), 'post_id', pg_temp.id('p3')),
        jsonb_build_object('user_id', pg_temp.id('m1'), 'post_id', pg_temp.id('p4'))))
  from v;
$$;

-- ── Guards ──────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon', 'kc_private.prod_copy_apply(jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'kc_private.prod_copy_apply(jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'kc_private.prod_copy_delete_all()', 'execute'),
  'members cannot apply or delete a copy');
select is(pg_temp.try($$select kc_private.prod_copy_apply(pg_temp.copy())$$), '42501',
  'without the dev marker a copy is refused (not_dev_environment)');

update kc_private.prod_copy_state set is_dev_environment = true where singleton;

select is(pg_temp.try($$select kc_private.prod_copy_apply(pg_temp.copy() || '{"format": 2}')$$),
  'prod_copy_bad_format', 'a document of another format is refused before anything is written');
select is(pg_temp.try($$select kc_private.prod_copy_apply(jsonb_build_object('format', 1, 'members',
            jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'email', 'real@example.test'))))$$),
  'prod_copy_bad_member_email', 'a member outside the copy''s seed addresses is refused (AC12)');

-- ── First copy ──────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"keep-me"}';
create temporary table first_run as select kc_private.prod_copy_apply(pg_temp.copy()) as r;

select is((select r - 'posts_skipped_by_reason' from first_run),
  '{"members": 3, "members_created": 3, "members_deleted": 0, "organizations": 1, "organizations_created": 1,
    "organizations_deleted": 0, "posts": 6, "posts_created": 6, "posts_deleted": 0, "posts_skipped": 2,
    "follows": 2, "saved_posts": 1}'::jsonb,
  'the first copy creates the members, the organization, the posts, the follows and the saves');
select is((select r -> 'posts_skipped_by_reason' from first_run),
  '{"ride_time_invalid": 1, "prod_copy_unknown_kind": 1}'::jsonb,
  'a departed ride and an unknown kind are skipped and counted by reason, without post data (AC10)');
select is(current_setting('request.jwt.claims'), '{"sub":"keep-me"}', 'the caller''s identity is restored after a copy');

select is(
  (select string_agg(u.display_name || '|' || u.city_id || '|' || a.status || '|' || a.onboarding_state
                     || '|' || au.encrypted_password || '|' || (au.raw_app_meta_data ->> 'prod_copy'), ',' order by u.display_name)
     from public.users u join public.user_account a on a.user_id = u.id join auth.users au on au.id = u.id
    where u.id = any (kc_private.prod_copy_member_ids())),
  'דנה לוי|c1|active|completed||true,יוסי פרץ|c2|active|completed||true,רון גולן|c1|active|completed||true',
  'copied members are active and onboarded, flagged as copied, and have no password (AC5, AC12)');
select ok(not exists (select 1 from public.posts p where p.owner_id = any (kc_private.prod_copy_member_ids())
                       and (p.visibility <> 'Public' or p.location_display_level <> 'CityOnly'
                            or p.shown_street is not null)),
  'every copied post is public and shows its city only (AC4)');
select is((select r.origin_city_id || '>' || r.dest_city_id || '|' || r.seats from public.post_ride_details r
            where r.post_id = pg_temp.id('p3')), 'c1>c2|3', 'a copied ride keeps its cities and seats');
select is((select f.allergens::text || '|' || f.kosher from public.post_food_details f where f.post_id = pg_temp.id('p5'))
          || ' ' || (select h.place_type || '|' || h.capacity from public.post_housing_details h where h.post_id = pg_temp.id('p9')),
  '{gluten}|true private_room|2', 'a copied food offer and a copied stay keep their world rows');
select ok(exists (select 1 from public.user_consents c where c.user_id = pg_temp.id('m2')
                   and c.consent_kind = 'driver_declaration'),
  'the owner of a copied ride offer holds the driver declaration');
select is((select count(*)::integer from public.posts where id = pg_temp.id('p8')), 0,
  'a post whose owner is not in the copy is never written');

-- ── Second run of the same copy, with kc-dev's own activity on copied data ─────
insert into public.follows (follower_id, followed_id) values (pg_temp.id('t'), pg_temp.id('m1'));
insert into public.saved_posts (user_id, post_id) values (pg_temp.id('t'), pg_temp.id('p1'));
select is((select kc_private.prod_copy_apply(pg_temp.copy())
             - array['members', 'organizations', 'posts', 'follows', 'saved_posts', 'posts_skipped_by_reason']),
  '{"members_created": 0, "members_deleted": 0, "organizations_created": 0, "organizations_deleted": 0,
    "posts_created": 0, "posts_deleted": 0, "posts_skipped": 2}'::jsonb,
  'the same copy again creates and deletes nothing');

-- ── Next week: production changed ───────────────────────────────────────────
create temporary table m1_share as select share_handle from public.users where id = pg_temp.id('m1');
select is((select kc_private.prod_copy_apply(pg_temp.copy('changed'))
             - array['organizations', 'organizations_created', 'organizations_deleted', 'posts_skipped',
                     'posts_skipped_by_reason']),
  '{"members": 2, "members_created": 0, "members_deleted": 1, "posts": 4, "posts_created": 1,
    "posts_deleted": 2, "follows": 1, "saved_posts": 1}'::jsonb,
  'a deleted member goes with their posts, a deleted post goes and a changed post is replaced (AC8)');
select is((select u.display_name || '|' || (u.share_handle = s.share_handle) from public.users u, m1_share s
            where u.id = pg_temp.id('m1')) || '|' || (select title from public.posts where id = pg_temp.id('p1')),
  'נועה כהן|true|ספה ושולחן', 'a renamed member is updated in place and a changed post carries its new fields');
select ok(exists (select 1 from public.follows where follower_id = pg_temp.id('t') and followed_id = pg_temp.id('m1')),
  'a kc-dev tester''s follow of a copied member survives the copy');
select is((select count(*)::integer from auth.users where id in (pg_temp.id('t'), pg_temp.id('d'), pg_temp.id('e'))), 3,
  'kc-dev''s own, demo and e2e accounts are never touched (AC8, AC12)');

-- ── Delete copied data ──────────────────────────────────────────────────────
select is(kc_private.prod_copy_delete_all() - 'saved_posts',
  '{"members": 2, "posts": 4, "organizations": 1, "follows": 1}'::jsonb,
  '"Delete copied data" reports what it deleted (AC13)');
select is(kc_private.prod_copy_counts() || jsonb_build_object(
            'own', (select count(*) from auth.users where id in (pg_temp.id('t'), pg_temp.id('d'), pg_temp.id('e'))),
            'last_copy_kept', (select last_copied_at is not null from kc_private.prod_copy_state)),
  '{"members": 0, "posts": 0, "organizations": 0, "follows": 0, "saved_posts": 0, "own": 3, "last_copy_kept": true}'::jsonb,
  'nothing copied is left; kc-dev''s own accounts stay and the time of the last copy is kept');

select * from finish();
rollback;
