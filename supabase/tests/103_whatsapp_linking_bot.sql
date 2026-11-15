-- WhatsApp linking and the bot (whatsapp_linking_and_bot_tools): link codes (Pro, rate
-- limit, redeem, lockout, one number per member), the member's status and switches, the
-- Pro gate with its upsell, the agent's read tools seeing only what the member may read,
-- and the publish path (owner check, confidence, review queue, photo rule, rate limit).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.uid(p_who text)
returns uuid
language sql
as $$ select ('00000000-0000-4000-8000-0000000000' || to_hex(ascii(p_who)))::uuid; $$;

-- Runs `p_sql` as a member ('svc' = the service role) and returns its single value as text
-- ('ok' for none), or the P0001 message / the SQLSTATE of its error.
create function pg_temp.run(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_role constant text := case p_who when 'svc' then 'service_role' else 'authenticated' end;
  v_out text;
begin
  -- The service role's token names no member.
  perform set_config('request.jwt.claims', case v_role when 'service_role' then jsonb_build_object('role', v_role)
    else jsonb_build_object('sub', pg_temp.uid(p_who), 'role', v_role) end::text, true);
  perform set_config('role', v_role, true);
  begin
    execute p_sql into v_out;
    v_out := coalesce(nullif(v_out, ''), 'ok');
  exception when others then
    v_out := case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return v_out;
end;
$$;

create temporary table t_ids (k text primary key, v text);
-- Remembers a value under a key and returns it.
create function pg_temp.keep(p_key text, p_value text)
returns text
language sql
as $$ insert into t_ids values (p_key, p_value) on conflict (k) do update set v = excluded.v returning v; $$;
create function pg_temp.v(p_key text)
returns text
language sql
as $$ select v from t_ids where k = p_key; $$;

-- A session of the number with an extraction applied; returns the session id.
create function pg_temp.session(p_wa text, p_world text, p_kind text, p_dir text, p_title text, p_conf numeric)
returns text
language plpgsql
as $$
declare
  v_session text := pg_temp.run('svc', format('select public.api_bot_open_session(%L)', p_wa));
begin
  perform pg_temp.run('svc', format('select public.api_bot_apply_extraction(%L, %L, %L, %L, %L, %L, %s)',
                                    v_session, p_world, p_kind, p_dir, p_title, '{}', p_conf));
  return v_session;
end;
$$;

select plan(52);

-- a: Pro, the bot user · b: another member · c: not Pro · d: blocked by a · x: no account use.
insert into auth.users (id, email, raw_app_meta_data)
select pg_temp.uid(x), 'u' || x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd', 'x']) x;
insert into public.cities (city_id, name_he, name_en) values ('c1', 'c1', 'City One');
update public.users set city_id = 'c1' where id <> pg_temp.uid('x');
insert into billing.user_entitlements (user_id, source) values (pg_temp.uid('a'), 'admin');
insert into public.blocks (blocker_id, blocked_id) values (pg_temp.uid('a'), pg_temp.uid('d'));
insert into public.worlds (slug, label_he, label_en) values ('items', 'חפצים', 'Items'), ('food', 'אוכל', 'Food');
insert into public.post_kinds (world_slug, slug, label_he, label_en, direction) values
  ('items', 'item_offer', 'o', 'o', 'offer'), ('items', 'item_request', 'r', 'r', 'request'),
  ('food', 'food_offer', 'o', 'o', 'offer'), ('food', 'food_request', 'r', 'r', 'request');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title, city_id)
select ('10000000-0000-4000-8000-00000000000' || n)::uuid, pg_temp.uid(o), 'items',
       (select k.id from public.post_kinds k where k.slug = 'item_' || d), d, 'open', v, t, 'c1'
  from (values (1, 'b', 'offer', 'Public', 'baby stroller'), (2, 'b', 'offer', 'OnlyMe', 'secret stroller'),
               (3, 'b', 'offer', 'FollowersOnly', 'friends stroller'), (4, 'd', 'offer', 'Public', 'blocked stroller'),
               (5, 'a', 'request', 'Public', 'looking for a stroller')) as p (n, o, d, v, t);

-- ── Link codes ──────────────────────────────────────────────────────────────
select is(pg_temp.run('c', 'select public.api_whatsapp_create_link_code()'), 'pro_required', 'a member without Pro gets no code');
select is(pg_temp.keep('code1', pg_temp.run('a', 'select public.api_whatsapp_create_link_code()') ::jsonb ->> 'code') ~ '^[0-9]{6}$',
  true, 'a Pro member gets a six-digit code');
select is((select code_hash = kc_private.whatsapp_link_code_hash(pg_temp.v('code1')) and expires_at = now() + interval '10 minutes'
             from integrations.whatsapp_link_codes where user_id = pg_temp.uid('a')), true,
  'only its hash is stored, valid for ten minutes');
select is(pg_temp.run('svc', $$select public.api_whatsapp_redeem_link_code('972500000009', '000000')$$) ::jsonb ->> 'status',
  'invalid', 'a wrong code is invalid');
select is((select string_agg(pg_temp.run('svc', $$select public.api_whatsapp_redeem_link_code('972500000009', '000000')$$)
                               ::jsonb ->> 'status', ',') from generate_series(1, 4)), 'invalid,invalid,invalid,invalid',
  'up to five failures in an hour');
select is(pg_temp.run('svc', format($$select public.api_whatsapp_redeem_link_code('972500000009', %L)$$, pg_temp.v('code1')))
  ::jsonb ->> 'status', 'locked', 'then the number is locked, even with the right code');
select is(pg_temp.run('svc', format($$select public.api_whatsapp_redeem_link_code('972500000001', %L)$$, pg_temp.v('code1'))),
  format('{"status": "linked", "user_id": "%s"}', pg_temp.uid('a')), 'another number redeems the code and is linked');
select is(pg_temp.run('svc', format($$select public.api_whatsapp_redeem_link_code('972500000002', %L)$$, pg_temp.v('code1')))
  ::jsonb ->> 'status', 'invalid', 'a code works once');
select pg_temp.keep('code2', pg_temp.run('a', 'select public.api_whatsapp_create_link_code()') ::jsonb ->> 'code');
select pg_temp.keep('link2', pg_temp.run('svc', format($$select public.api_whatsapp_redeem_link_code('972500000002', %L)$$,
                                                     pg_temp.v('code2'))) ::jsonb ->> 'status');
select is(pg_temp.v('link2') || ':' || (select string_agg(wa_id, ',') from integrations.whatsapp_identities where user_id = pg_temp.uid('a')),
  'linked:972500000002', 'linking a second number unlinks the first (one number per member)');
select pg_temp.keep('code3', pg_temp.run('a', 'select public.api_whatsapp_create_link_code()') ::jsonb ->> 'code');
update integrations.whatsapp_link_codes set expires_at = now() - interval '1 second' where user_id = pg_temp.uid('a');
select is(pg_temp.run('svc', format($$select public.api_whatsapp_redeem_link_code('972500000003', %L)$$, pg_temp.v('code3')))
  ::jsonb ->> 'status', 'invalid', 'an expired code is invalid');
insert into billing.user_entitlements (user_id, source) values (pg_temp.uid('c'), 'admin');
select pg_temp.keep('code4', pg_temp.run('c', 'select public.api_whatsapp_create_link_code()') ::jsonb ->> 'code');
update billing.user_entitlements set active = false where user_id = pg_temp.uid('c');
select is(pg_temp.run('svc', format($$select public.api_whatsapp_redeem_link_code('972500000003', %L)$$, pg_temp.v('code4')))
  ::jsonb ->> 'status', 'not_pro', 'a member who lost Pro meanwhile is not linked');

-- ── The member's status and switches ────────────────────────────────────────
select is(pg_temp.run('a', 'select public.api_whatsapp_my_link_status()'),
  '{"is_pro": true, "linked": true, "wa_id_masked": "•••0002", "phone_opted_out": false, "consent_opted_in": false}',
  'the member sees the linked number masked, Pro and alert consent');
select is(pg_temp.run('a', 'select public.api_whatsapp_set_match_consent(true)') ::jsonb ->> 'consent_opted_in', 'true',
  'the member turns WhatsApp alerts on');
select is((select status from integrations.whatsapp_outbound_messages where template_name = 'opt_in_confirm_v1'),
  'skipped_channel_disabled', 'which queues the opt-in confirmation (not sent while the channel is off)');
select is(pg_temp.run('a', 'select public.api_whatsapp_set_match_consent(false)') ::jsonb ->> 'phone_opted_out', 'true',
  'turning them off also stops the number');
select is((select string_agg(action || ':' || source, ',' order by created_at, action)
             from integrations.whatsapp_consent_events where user_id = pg_temp.uid('a')), 'opt_in:app,opt_out:app',
  'both switches are recorded');
select is(pg_temp.run('a', 'select public.api_whatsapp_set_match_consent(true)') ::jsonb ->> 'phone_opted_out', 'true',
  'an opt-in in the app never lifts a STOP of the phone');
select is(kc_private.whatsapp_user_can_receive(pg_temp.uid('a')), false, 'so no alert is sent until the phone says START');
select is(pg_temp.run(null, 'select public.api_whatsapp_my_link_status()'), '42501', 'signed out there is no status');

-- ── Pro gate ────────────────────────────────────────────────────────────────
select is(pg_temp.run('svc', $$select public.api_whatsapp_bot_access('972500000002')$$) ::jsonb ->> 'access', 'pro',
  'a number linked to a Pro member reaches the bot');
insert into integrations.whatsapp_identities (wa_id) values ('972500000007');
select is(pg_temp.run('svc', $$select public.api_whatsapp_bot_access('972500000007')$$),
  '{"access": "unlinked", "upsell": true, "user_id": null}', 'an unlinked number gets the upsell');
select is(pg_temp.run('svc', $$select public.api_whatsapp_bot_access('972500000007')$$) ::jsonb ->> 'upsell', 'false',
  'at most once a day');
insert into integrations.whatsapp_identities (wa_id, user_id) values ('972500000008', pg_temp.uid('c'));
select is(pg_temp.run('svc', $$select public.api_whatsapp_bot_access('972500000008')$$) ::jsonb ->> 'access', 'not_pro',
  'a member without Pro is told about Pro');
update public.users set is_active = false where id = pg_temp.uid('c');
select is(pg_temp.run('svc', $$select public.api_whatsapp_bot_access('972500000008')$$),
  format('{"access": "inactive", "upsell": false, "user_id": "%s"}', pg_temp.uid('c')), 'an inactive member gets nothing');

-- ── Read tools: only what the member may read ───────────────────────────────
select is(pg_temp.run('svc', format($$select string_agg(title, ',') from public.api_bot_search_posts(%L, 'stroller')$$, pg_temp.uid('a'))),
  'looking for a stroller,baby stroller',
  'search returns the member''s own and public posts, never another member''s private, followers-only or blocked post');
insert into public.follows (follower_id, followed_id) values (pg_temp.uid('a'), pg_temp.uid('b'));
select is(pg_temp.run('svc', format($$select count(*) from public.api_bot_search_posts(%L, 'stroller', 'items')$$, pg_temp.uid('a'))),
  '3', 'a followers-only post appears once the member follows its owner');
select is(pg_temp.run('svc', format($$select string_agg(title, ',') from public.api_bot_search_posts(%L, 'stroller')$$, pg_temp.uid('b'))),
  'looking for a stroller,blocked stroller,friends stroller,secret stroller,baby stroller',
  'another member sees by their own rights (their own private posts included)');
select is(pg_temp.run('svc', format($$select count(*) from public.api_bot_search_posts(%L, 's')$$, pg_temp.uid('a'))), '0',
  'a one-letter query returns nothing');
select is(pg_temp.run('svc', format($$select string_agg(title, ',') from public.api_bot_post_cards(%L, array[%L, %L]::uuid[])$$,
                                    pg_temp.uid('a'), '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001')),
  'baby stroller', 'cards leave out a post the member may not read');
select is(pg_temp.run('svc', format($$select count(*) from public.api_bot_my_posts(%L)$$, pg_temp.uid('b'))), '3',
  'the member''s own open posts');
insert into kc_private.match_candidates (offer_post_id, request_post_id, offer_owner_id, request_owner_id, world_slug, score) values
  ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', pg_temp.uid('b'), pg_temp.uid('a'), 'items', 0.9),
  ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000005', pg_temp.uid('b'), pg_temp.uid('a'), 'items', 0.8);
select is(pg_temp.run('svc', format($$select string_agg(my_post_title || '>' || other_title, ',') from public.api_bot_my_matches(%L)$$, pg_temp.uid('a'))),
  'looking for a stroller>baby stroller', 'matches leave out a pair whose other post the member may not read');
select is(pg_temp.run('svc', format($$select count(*) from public.api_bot_my_posts(%L)$$, pg_temp.uid('c'))), 'account_not_active',
  'a tool refuses an inactive member');

-- ── Publishing ──────────────────────────────────────────────────────────────
select pg_temp.keep('s1', pg_temp.session('972500000002', 'items', 'item_request', 'request', 'need a crib', 0.9));
select is((select state || ':' || (draft ->> 'direction') from integrations.bot_conversation_sessions where id = pg_temp.v('s1')::uuid),
  'confirm:request', 'an extraction moves the session to confirm');
select is(pg_temp.run('svc', format('select public.api_bot_publish_post(%L, %L)', pg_temp.v('s1'), pg_temp.uid('b'))), '42501',
  'only the number''s linked member can be the owner');
select is(pg_temp.keep('p1', pg_temp.run('svc', format('select public.api_bot_publish_post(%L, %L)', pg_temp.v('s1'), pg_temp.uid('a'))))
  ::jsonb - 'post_id', '{"review": false, "status": "open", "photo_required": false}', 'a confident request is published');
select is((select owner_id = pg_temp.uid('a') and source = 'native' and city_id = 'c1' and location_display_level = 'CityOnly'
             and visibility = 'Public'
             from public.posts where id = (pg_temp.v('p1')::jsonb ->> 'post_id')::uuid), true,
  'as a native, public post of the owner at city level');
select is((select session_id::text from integrations.bot_post_origins where post_id = (pg_temp.v('p1')::jsonb ->> 'post_id')::uuid),
  pg_temp.v('s1'), 'its origin is recorded');
select is(pg_temp.run('svc', format('select public.api_bot_publish_post(%L, %L)', pg_temp.v('s1'), pg_temp.uid('a'))),
  'session_not_ready', 'a session is published once');
select is(pg_temp.run('svc', format($$select public.api_bot_apply_extraction(%L, 'items', 'food_offer', 'give', 'x')$$,
                                    pg_temp.run('svc', $$select public.api_bot_open_session('972500000002')$$))),
  'kind_not_found', 'the kind must belong to the world');
select is(pg_temp.run('svc', format($$select public.api_bot_apply_extraction(%L, 'items', 'item_offer', 'lend', 'x')$$,
                                    pg_temp.run('svc', $$select public.api_bot_open_session('972500000002')$$))),
  'invalid_direction', 'the direction is give or request');
select is(pg_temp.run('svc', format($$select public.api_bot_apply_extraction(%L, 'items', 'item_offer', 'give', 'x')$$,
                                    '00000000-0000-4000-8000-000000000000')), 'session_not_found', 'an unknown session is refused');

select pg_temp.keep('s2', pg_temp.session('972500000002', 'items', 'item_request', 'request', 'need a high chair', 0.5));
select is((select reason || ':' || coalesce(post_id::text, '-') from integrations.bot_review_items where session_id = pg_temp.v('s2')::uuid),
  'low_confidence_extraction:-', 'an unsure extraction is queued for review at once');
select is(pg_temp.keep('p2', pg_temp.run('svc', format('select public.api_bot_publish_post(%L, %L)', pg_temp.v('s2'), pg_temp.uid('a'))))
  ::jsonb ->> 'status', 'draft', 'and its post stays a draft');
select is((select count(*) || ':' || bool_and(post_id = (pg_temp.v('p2')::jsonb ->> 'post_id')::uuid)
             from integrations.bot_review_items where session_id = pg_temp.v('s2')::uuid), '1:true',
  'the same review item now points at the draft');
select pg_temp.keep('s3', pg_temp.session('972500000002', 'items', 'item_request', 'request', 'need a bike', 0.8));
select pg_temp.keep('p3', pg_temp.run('svc', format('select public.api_bot_publish_post(%L, %L)', pg_temp.v('s3'), pg_temp.uid('a'))));
select is((select reason from integrations.bot_review_items where post_id = (pg_temp.v('p3')::jsonb ->> 'post_id')::uuid),
  'publish_pending_review', 'a post below the publish confidence is a draft with a review item');
select pg_temp.keep('s4', pg_temp.session('972500000002', 'items', 'item_offer', 'give', 'a sofa to give', 1));
select is(pg_temp.run('svc', format('select public.api_bot_publish_post(%L, %L)', pg_temp.v('s4'), pg_temp.uid('a')))
  ::jsonb - 'post_id', '{"review": false, "status": "draft", "photo_required": true}',
  'an offer in a photo world waits for its photo as a draft (D132)');
select pg_temp.keep('s5', pg_temp.session('972500000002', 'food', 'food_offer', 'give', 'soup', 1));
select is(pg_temp.run('svc', format('select public.api_bot_publish_post(%L, %L)', pg_temp.v('s5'), pg_temp.uid('a'))),
  'food_expiry_required', 'a food offer needs its expiry');
select pg_temp.keep('s6', pg_temp.session('972500000002', 'food', 'food_request', 'request', 'need bread', 1));
update public.users set city_id = null where id = pg_temp.uid('a');
select is(pg_temp.run('svc', format('select public.api_bot_publish_post(%L, %L)', pg_temp.v('s6'), pg_temp.uid('a'))),
  'city_required', 'the owner needs a city');
update public.users set city_id = 'c1' where id = pg_temp.uid('a');
update kc_private.rate_limits set max_count = 1 where action = 'post_create';
delete from kc_private.rate_limit_counters where key like 'post_create:%';
select is(pg_temp.run('svc', format('select public.api_bot_publish_post(%L, %L)', pg_temp.v('s6'), pg_temp.uid('a'))) ::jsonb ->> 'status'
  || ',' || pg_temp.run('svc', format('select public.api_bot_publish_post(%L, %L)',
                                      pg_temp.session('972500000002', 'food', 'food_request', 'request', 'need rice', 1), pg_temp.uid('a'))),
  'open,rate_limited', 'the member''s post rate limit applies to bot posts');

-- ── Unlinking ───────────────────────────────────────────────────────────────
select is(pg_temp.run('a', 'select public.api_whatsapp_unlink_me()') || ':'
  || (pg_temp.run('a', 'select public.api_whatsapp_my_link_status()') ::jsonb ->> 'linked'), 'ok:false', 'the member unlinks');
select is((select consent_status from integrations.whatsapp_identities where wa_id = '972500000002'), 'opted_out',
  'the number and its STOP stay');
select is(pg_temp.run('svc', format('select public.api_bot_publish_post(%L, %L)',
                                    pg_temp.session('972500000002', 'items', 'item_request', 'request', 'x y', 1), pg_temp.uid('a'))),
  '42501', 'an unlinked number cannot post for anyone');

select * from finish();
rollback;
