-- Basic guest reads must not grant anonymous access to member tables or identities.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(16);
insert into auth.users (id, email, raw_app_meta_data) values
 ('00000000-0000-4000-8000-00000000000a', 'guest-owner@example.test', '{"provider":"google"}');
insert into public.cities(city_id,name_he,name_en) values ('guest-city','City HE','City EN');
insert into public.worlds(slug,label_he,label_en) values ('guest_test','Test','Test');
insert into public.post_kinds(id,world_slug,slug,label_he,label_en,direction) values
 ('20000000-0000-4000-8000-000000000001','guest_test','item','Item','Item','either');
insert into public.posts(id,owner_id,world_slug,kind_id,direction,title,description,city_id,visibility)
select ('40000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-00000000000a','guest_test','20000000-0000-4000-8000-000000000001',
 'request','guest ' || n,'Description','guest-city',
 case n when 2 then 'FollowersOnly' when 3 then 'OnlyMe' else 'Public' end
from generate_series(1,8) n;
select set_config('kc.fsm_role','owner',true);
update public.posts set status='paused' where title='guest 4';
update public.posts set status='closed_delivered' where title='guest 5';
select set_config('kc.fsm_role','system',true);
update public.posts set status='hidden_pending_review' where title='guest 6';
update public.posts set expires_at=now()-interval '1 day' where title='guest 7';
select set_config('kc.fsm_role','admin',true);
update public.posts set status='removed_admin' where title='guest 8';
select set_config('kc.fsm_role','',true);

select ok(has_function_privilege('anon','public.guest_posts(uuid,uuid,integer)','execute'),'anon may use the guest RPC');
select ok(not has_table_privilege('anon','public.posts','select'),'anon cannot read posts table');
select ok(not has_table_privilege('anon','public.users','select'),'anon cannot read member identities');
select ok(not has_table_privilege('anon','public.post_media','select'),'anon cannot enumerate media paths');
select ok(not has_function_privilege('anon','public.post_detail(uuid)','execute'),'member detail stays closed');
set local role anon;
select is((select count(*) from public.guest_posts()),1::bigint,'only one open Public fixture is visible');
select is((select title from public.guest_posts()),'guest 1','the public title is readable');
select is((select array_agg(key order by key) from jsonb_object_keys((select to_jsonb(g) from public.guest_posts() g limit 1)) key),array['city_name_en','city_name_he','description','id','title'],'DTO has no member identity, media or details');
select is((select count(*) from public.guest_posts('40000000-0000-4000-8000-000000000002')),0::bigint,'followers-only not readable by id');
select is((select count(*) from public.guest_posts('40000000-0000-4000-8000-000000000003')),0::bigint,'private not readable by id');
select is((select count(*) from public.guest_posts('40000000-0000-4000-8000-000000000008')),0::bigint,'moderated not readable by id');
select throws_ok('select * from public.posts','42501',null,'direct table read denied');
select throws_ok('select public.post_detail(''40000000-0000-4000-8000-000000000001'')','42501',null,'member RPC denied');
reset role;
update public.users set is_active=false where id='00000000-0000-4000-8000-00000000000a';
set local role anon;
select is((select count(*) from public.guest_posts()),0::bigint,'inactive owner is hidden');
reset role;
update public.users set is_active=true where id='00000000-0000-4000-8000-00000000000a';
update public.worlds set is_active=false where slug='guest_test';
set local role anon;
select is((select count(*) from public.guest_posts()),0::bigint,'inactive world is hidden');
reset role;
update public.worlds set is_active=true where slug='guest_test';
update public.post_kinds set is_active=false where world_slug='guest_test';
set local role anon;
select is((select count(*) from public.guest_posts()),0::bigint,'inactive kind is hidden');
reset role;
select * from finish();
rollback;
