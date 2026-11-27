-- App Store 5.1.1(v) / #2728: guests read the map and member profiles through narrow anon RPCs only.
-- Same eligibility as guest_posts, approximate coordinates, public profile fields, no table access.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
-- The baseline revokes default function EXECUTE before this extension may exist.
-- Keep assertion-helper access inside this rolled-back test transaction only.
grant usage on schema extensions to anon;
grant execute on all functions in schema extensions to anon;
select plan(38);
insert into auth.users (id, email, raw_app_meta_data) values
 ('00000000-0000-4000-8000-00000000000b', 'guest-map-owner@example.test', '{"provider":"google"}');
update public.users set share_handle = 'guest_owner', biography = 'Hello', city_id = null
 where id = '00000000-0000-4000-8000-00000000000b';
insert into public.cities(city_id,name_he,name_en,location) values
 ('guest-map-city','Map HE','Map EN','SRID=4326;POINT(34.78 32.08)');
insert into public.worlds(slug,label_he,label_en) values ('guest_map','Test','Test');
insert into public.post_kinds(id,world_slug,slug,label_he,label_en,direction) values
 ('20000000-0000-4000-8000-000000000002','guest_map','item','Item','Item','either');
insert into public.posts(id,owner_id,world_slug,kind_id,direction,title,description,city_id,visibility,location_display_level)
select ('50000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-00000000000b','guest_map','20000000-0000-4000-8000-000000000002',
 'request','map ' || n,'Description','guest-map-city',
 case n when 2 then 'FollowersOnly' when 3 then 'OnlyMe' else 'Public' end,
 case n when 9 then 'FullAddress' else 'CityOnly' end
from generate_series(1,9) n;
-- Post 9 has an exact address; its geo_approx is the coarsened, jittered point.
insert into public.post_private_locations(post_id, exact_point) values
 ('50000000-0000-4000-8000-000000000009', 'SRID=4326;POINT(34.791234 32.071234)');
select set_config('kc.fsm_role','owner',true);
update public.posts set status='paused' where title='map 4';
update public.posts set status='closed_delivered' where title='map 5';
select set_config('kc.fsm_role','system',true);
update public.posts set status='hidden_pending_review' where title='map 6';
update public.posts set expires_at=now()-interval '1 day' where title='map 7';
select set_config('kc.fsm_role','admin',true);
update public.posts set status='removed_admin' where title='map 8';
select set_config('kc.fsm_role','',true);

-- Grants: anon only, nothing else opened.
select ok(has_function_privilege('anon','public.guest_map_post_pins(jsonb,jsonb,integer)','execute'),'anon may read guest map pins');
select ok(has_function_privilege('anon','public.guest_profile(text)','execute'),'anon may read a guest profile');
select ok(has_function_privilege('anon','public.guest_profile_posts(text,uuid,integer)','execute'),'anon may read guest profile posts');
select ok(not has_function_privilege('authenticated','public.guest_map_post_pins(jsonb,jsonb,integer)','execute'),'members keep their own map RPC');
select ok(not has_function_privilege('authenticated','public.guest_profile(text)','execute'),'members keep their own profile reads');
select ok(not has_function_privilege('authenticated','public.guest_profile_posts(text,uuid,integer)','execute'),'members keep profile_posts_page');
select ok(not has_function_privilege('anon','public.map_post_pins(jsonb,jsonb,integer)','execute'),'member map pins stay closed to anon');
select ok(not has_function_privilege('anon','public.profile_posts_page(uuid,jsonb,integer,text,text[])','execute'),'member profile posts stay closed to anon');
select ok(not has_schema_privilege('anon','kc_access','usage'),'anon cannot reach the guest eligibility view');
select ok(not has_table_privilege('authenticated','kc_access.guest_open_posts','select'),'members cannot read the guest view directly');
select ok(not has_table_privilege('anon','public.users','select'),'anon cannot read member identities');
select ok(not has_table_privilege('anon','public.user_stats','select'),'anon cannot read member counters');
select ok(not has_table_privilege('anon','public.post_private_locations','select'),'anon cannot read exact locations');

set local role anon;
-- Map pins.
select is((select array_agg(post_id order by post_id) from public.guest_map_post_pins('{"west":34,"south":31,"east":35,"north":33}','{"world":"guest_map"}')),
  array['50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000009']::uuid[],'only open Public posts are pinned');
select is((select array_agg(post_id order by post_id) from public.guest_map_post_pins('{"west":34,"south":31,"east":35,"north":33}','{"world":"guest_map"}')),
  (select array_agg(id order by id) from public.guest_posts(p_limit => 20) where id::text like '50000000-%'),'pins and guest_posts share one eligibility rule');
select is((select count(*) from public.guest_map_post_pins('{"west":-10,"south":-10,"east":10,"north":10}','{"world":"guest_map"}')),0::bigint,'outside the bounds is empty');
select is((select array_agg(key order by key) from jsonb_object_keys((select to_jsonb(g) from public.guest_map_post_pins('{"west":34,"south":31,"east":35,"north":33}') g limit 1)) key),
  array['direction','lat','lng','post_id','world_slug'],'pin shape matches map_post_pins');
select ok((select bool_and(lat = round(lat::numeric,2)::double precision and lng = round(lng::numeric,2)::double precision)
             from public.guest_map_post_pins('{"west":34,"south":31,"east":35,"north":33}','{"world":"guest_map"}')),'guest coordinates are snapped to 0.01 degree');
select ok((select (lat, lng) <> (32.071234::double precision, 34.791234::double precision)
             from public.guest_map_post_pins('{"west":34,"south":31,"east":35,"north":33}','{"world":"guest_map"}')
            where post_id = '50000000-0000-4000-8000-000000000009'),'the exact address point is never returned');
select ok((select count(*) <= 200 from public.guest_map_post_pins('{"west":-170,"south":-80,"east":170,"north":80}', '{}', 100000)),'pins are capped');
select throws_ok($$select * from public.guest_map_post_pins('{"west":35,"south":31,"east":34,"north":33}')$$,'P0001','invalid_bounds','bad bounds are rejected');
-- Profile.
select is((select array_agg(key order by key) from jsonb_object_keys((select to_jsonb(g) from public.guest_profile('guest_owner') g)) key),
  array['avatar_url','biography','city_name_en','city_name_he','display_name','followers_count','following_count','items_given_count','items_received_count','open_posts_count','share_handle','verification_level'],
  'profile DTO has public fields only: no id, contact, settings or account state');
select is((select biography || '|' || open_posts_count from public.guest_profile('guest_owner')),'Hello|2','public profile and its guest-visible open posts count');
select is((select array_agg(key order by key) from jsonb_object_keys((select to_jsonb(g) from public.guest_posts(p_post_id => '50000000-0000-4000-8000-000000000001') g)) key),
  array['author_share_handle','city_name_en','city_name_he','description','id','title'],
  'guest_posts DTO has the public author handle and no private columns');
select is((select array_agg(key order by key) from jsonb_object_keys((select to_jsonb(g) from public.guest_profile_posts('guest_owner') g limit 1)) key),
  array['author_share_handle','city_name_en','city_name_he','description','id','title'],
  'guest_profile_posts shares the guest_posts shape');
select is((select author_share_handle from public.guest_posts(p_post_id => '50000000-0000-4000-8000-000000000001')),
  (select share_handle from public.guest_profile('guest_owner')),
  'author_share_handle matches the public profile handle');
select is((select author_share_handle from public.guest_profile_posts('guest_owner') where id = '50000000-0000-4000-8000-000000000001'),
  'guest_owner','profile posts carry the same public handle');
select is((select array_agg(id order by id) from public.guest_profile_posts('guest_owner')),
  array['50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000009']::uuid[],'profile posts: open Public only');
select is((select array_agg(id) from public.guest_profile_posts('guest_owner', '50000000-0000-4000-8000-000000000009')),
  array['50000000-0000-4000-8000-000000000001']::uuid[],'profile posts page with the before-id cursor');
select is((select count(*) from public.guest_profile('no_such_handle')),0::bigint,'unknown handle returns nothing');
select throws_ok('select * from public.users','42501',null,'direct users read denied');
select throws_ok($$select * from public.map_post_pins('{"west":34,"south":31,"east":35,"north":33}')$$,'42501',null,'member map RPC denied');
reset role;

update public.users set privacy_mode='Private' where id='00000000-0000-4000-8000-00000000000b';
set local role anon;
select is((select count(*) from public.guest_profile('guest_owner')),0::bigint,'private profile returns nothing');
select is((select count(*) from public.guest_profile_posts('guest_owner')),0::bigint,'private profile posts return nothing');
select is((select author_share_handle from public.guest_posts(p_post_id => '50000000-0000-4000-8000-000000000001')),
  null::text,'private profile: the post stays visible and the author handle is withheld');
reset role;
update public.users set privacy_mode='Public', is_active=false where id='00000000-0000-4000-8000-00000000000b';
set local role anon;
select is((select count(*) from public.guest_profile('guest_owner')),0::bigint,'inactive (suspended or pending deletion) profile returns nothing');
select is((select count(*) from public.guest_profile_posts('guest_owner')),0::bigint,'inactive profile posts return nothing');
select is((select count(*) from public.guest_map_post_pins('{"west":34,"south":31,"east":35,"north":33}','{"world":"guest_map"}')),0::bigint,'inactive owner is not pinned');
reset role;
select * from finish();
rollback;
