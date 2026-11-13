-- Platform: the rate limiter counts exactly and is wired into every limited write path;
-- feature flags are read by members and written by the super admin only; storage buckets
-- and their policies; the counter reconciliation finds and repairs a corrupted counter.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs one statement as member a…e (null = the database owner) and returns 'ok', the
-- P0001 message or the SQLSTATE. `@x` is the member with that letter, `#pN` post N.
create function pg_temp.expand(p_sql text)
returns text
language sql
as $$
  select regexp_replace(regexp_replace(p_sql,
    '@([a-e])\M', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g'),
    '#p([0-9])\M', '''40000000-0000-4000-8000-00000000000\1''::uuid', 'g');
$$;

create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
begin
  begin
    if p_who is not null then
      perform set_config('request.jwt.claims', jsonb_build_object(
        'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
      perform set_config('role', case p_who when 'anon' then 'anon' else 'authenticated' end, true);
    end if;
    execute v_sql;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return 'ok';
  exception when others then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- The same statement three times (`%s` = 1, 2, 3), results joined by '|'.
create function pg_temp.thrice(p_who text, p_sql text)
returns text
language sql
as $$
  select string_agg(pg_temp.act(p_who, replace(p_sql, '%s', n::text)), '|' order by n) from generate_series(1, 3) n;
$$;

-- Rows a member can read with the query.
create function pg_temp.seen(p_who text, p_sql text)
returns bigint
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
  v_rows bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute 'select count(*) from (' || v_sql || ') q' into v_rows;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return v_rows;
end;
$$;

select plan(47);

insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || m)::uuid, m || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd', 'e']) m;
insert into public.cities (city_id, name_he, name_en) values ('c1', 'c1', 'City One');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'Items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'Item', 'either');
-- Alice's posts 1…4 are open and public; created by the owner role, so not rate limited.
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title, city_id)
select ('40000000-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-4000-8000-00000000000a', 'items',
       '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'Public', 'post ' || n, 'c1'
  from generate_series(1, 4) n;

-- ── The limiter ─────────────────────────────────────────────────────────────
select is((select string_agg(kc_private.rate_limit('k1', 3, interval '1 minute')::text, ',' order by n)
             from generate_series(1, 5) n), 'true,true,true,false,false', 'exactly p_max hits pass in a window');
select is(kc_private.rate_limit('k2', 3, interval '1 minute'), true, 'keys are counted apart');
update kc_private.rate_limit_counters set expires_at = now() - interval '1 second' where key = 'k1';
select is((select string_agg(kc_private.rate_limit('k1', 3, interval '1 minute')::text, ',' order by n)
             from generate_series(1, 4) n), 'true,true,true,false', 'a new window starts once the old one ended');
select is((select hits || '/' || (expires_at = now() + interval '1 minute')
             from kc_private.rate_limit_counters where key = 'k1'), '4/true', 'the new window starts at the first hit after the old one');
select throws_ok($$select kc_private.rate_limit('k', 0, interval '1 minute')$$, '22023', null, 'a limit below one is refused');
select throws_ok($$select kc_private.rate_limit('', 1, interval '1 minute')$$, '22023', null, 'an empty key is refused');

select is(pg_temp.act(null, $$select kc_private.rate_limit_enforce('follow', @a)$$)
  || (select count(*) from kc_private.rate_limit_counters where key like 'follow:%'), 'ok0',
  'work that is not the member''s own request is not counted');
select is(pg_temp.act(null, $$select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a"}', true);
    select kc_private.rate_limit_enforce('no_such_action', @a)$$), 'ok', 'an action without a limit passes');
select is((select count(*) from ops.warnings where key = 'rate_limit_unconfigured:no_such_action'), 1::bigint,
  'and leaves a warning');
select is(pg_temp.act('a', $$select kc_private.rate_limit_enforce('follow', @a)$$), '42501',
  'a member cannot call the limiter');

-- ── Every wired action: with the limit set to two, the third write is refused ─────────────
update kc_private.rate_limits set max_count = 2, "window" = interval '1 hour';

select is(pg_temp.thrice('b', $$insert into public.posts (owner_id, world_slug, kind_id, direction, status, title, city_id)
  values (@b, 'items', '20000000-0000-4000-8000-000000000001', 'offer', 'draft', 'draft %s', 'c1')$$),
  'ok|ok|rate_limited', 'creating a post is limited');
select is(pg_temp.act(null, $$insert into public.posts (owner_id, world_slug, kind_id, direction, status, title, city_id)
  values (@b, 'items', '20000000-0000-4000-8000-000000000001', 'offer', 'draft', 'by the server', 'c1')$$)
  || '|' || pg_temp.act('b', $$select set_config('kc.rate_limit_exempt', 'on', true);
       insert into public.posts (owner_id, world_slug, kind_id, direction, status, title, city_id)
       values (@b, 'items', '20000000-0000-4000-8000-000000000001', 'offer', 'draft', 'series', 'c1');
       select set_config('kc.rate_limit_exempt', '', true)$$),
  'ok|ok', 'server code and an exempt transaction are not limited');
select is(pg_temp.act('b', 'select public.follow_user(@a)') || '|' || pg_temp.act('b', 'select public.follow_user(@c)')
  || '|' || pg_temp.act('b', 'select public.follow_user(@d)'), 'ok|ok|rate_limited', 'following is limited');
select is(pg_temp.thrice('b', $$insert into public.post_comments (post_id, author_id, body) values (#p1, @b, 'c %s')$$),
  'ok|ok|rate_limited', 'commenting is limited');
select is(pg_temp.thrice('b', $$select public.set_post_reaction(#p%s, 'like')$$),
  'ok|ok|rate_limited', 'reacting is limited');
select is(pg_temp.thrice('b', $$insert into public.post_shares (post_id, user_id, share_kind) values (#p%s, @b, 'in_app')$$),
  'ok|ok|rate_limited', 'sharing is limited');
select is(pg_temp.thrice('b', $$insert into public.reports (reporter_id, target_type, target_id, reason) values (@b, 'post', #p%s, 'Spam')$$),
  'ok|ok|rate_limited', 'reporting is limited');
select is(pg_temp.thrice('c', 'select public.reserve_item_giving(#p%s)'),
  'ok|ok|rate_limited', 'asking for an item is limited');
select is(pg_temp.act('d', 'select public.open_direct_chat(@e)')
  || '|' || pg_temp.thrice('d', $$select public.send_message((select id from public.chats where kind = 'direct'
       and @d in (direct_user_a, direct_user_b) and @e in (direct_user_a, direct_user_b)), 'hello %s')$$),
  'ok|ok|ok|rate_limited', 'sending a message is limited');
insert into public.organizations (id, slug, name, is_verified_nonprofit)
values ('60000000-0000-4000-8000-000000000001', 'aid', 'Aid', true);
insert into billing.payment_providers (slug, display_name, is_default) values ('grow', 'Grow', true);
select is(pg_temp.thrice('e', $$select public.create_donation_intent('60000000-0000-4000-8000-000000000001', 1000, 'key-0000%s')$$),
  'ok|ok|rate_limited', 'starting a donation is limited');
select is(pg_temp.act('e', $$select public.create_donation_intent('60000000-0000-4000-8000-000000000001', 1000, 'key-00001')$$),
  'ok', 'repeating a donation call with its key is not a new attempt');
insert into billing.user_entitlements (user_id, source) values ('00000000-0000-4000-8000-00000000000e', 'admin');
select is(pg_temp.thrice('e', 'select public.api_whatsapp_create_link_code()'),
  'ok|ok|rate_limited', 'issuing WhatsApp link codes is limited');
select is((select count(*) from kc_private.rate_limits l
            where not exists (select 1 from kc_private.rate_limit_counters c where c.key like l.action || ':%')),
  0::bigint, 'every configured limit was exercised by this file');

-- ── Feature flags ───────────────────────────────────────────────────────────
insert into public.admin_role_grants (user_id, role) values ('00000000-0000-4000-8000-00000000000a', 'super_admin');
select is(pg_temp.act('b', $$select public.admin_set_app_flag('world_rides_enabled', true)$$)
  || '|' || pg_temp.act('b', $$insert into public.app_flags (key, enabled) values ('x_flag', true)$$)
  || '|' || pg_temp.act('a', $$select public.admin_set_app_flag('Bad Key', true)$$),
  '42501|42501|invalid_flag_key', 'only the super admin writes a flag, and only through the RPC');
select is(pg_temp.act('a', $$select public.admin_set_app_flag('world_rides_enabled', true, 'Rides world')$$)
  || '|' || pg_temp.act('a', $$select public.admin_set_app_flag('world_food_enabled', false)$$), 'ok|ok', 'the super admin creates flags');
select is(pg_temp.seen('b', 'select 1 from public.app_flags'), 2::bigint, 'a member reads the flags');
select is(pg_temp.act('b', 'update public.app_flags set enabled = false') || '|' || pg_temp.act('b', 'delete from public.app_flags')
  || '|' || pg_temp.act('b', 'select updated_by from public.app_flags'), '42501|42501|42501',
  'a member cannot change a flag or see who switched it');
select is(pg_temp.act('anon', 'select 1 from public.app_flags'), '42501', 'flags are not readable signed out');
select is(pg_temp.seen('b', $$select 1 where kc_access.flag_enabled('world_rides_enabled')
    and not kc_access.flag_enabled('world_food_enabled') and not kc_access.flag_enabled('no_such_flag')$$), 1::bigint,
  'flag_enabled: on, off, and off for an unknown flag');
select is(pg_temp.act('a', $$select public.admin_set_app_flag('world_rides_enabled', false)$$), 'ok', 'the super admin switches a flag');
select is('ok' || (select enabled::text || '/' || description || '/' || (updated_by = '00000000-0000-4000-8000-00000000000a')::text
        from public.app_flags where key = 'world_rides_enabled'), 'okfalse/Rides world/true',
  'switching keeps the description and records who switched');
select is((select count(*) from audit.events where action = 'app_flag_set' and metadata ->> 'key' = 'world_rides_enabled'),
  2::bigint, 'every switch is audited');
select is(pg_temp.seen('b', $$select 1 where public.bootstrap_session() -> 'flags'
    = '{"world_rides_enabled": false, "world_food_enabled": false}'::jsonb$$), 1::bigint,
  'bootstrap_session carries the flags');

-- ── Storage (through the local stand-in of the storage schema) ──────────────
select is((select string_agg(id || ':' || public || ':' || file_size_limit || ':' || array_to_string(allowed_mime_types, '+'), ' ' order by id)
             from storage.buckets),
  'avatars:true:524288:image/jpeg chat-media:false:5242880:image/jpeg+image/png+image/webp post-images:true:8388608:image/jpeg+image/png',
  'every bucket has a size limit and a MIME allow-list; only chat media is private');
select is((select count(*) from storage.buckets where file_size_limit is null or allowed_mime_types is null), 0::bigint,
  'no bucket is unlimited');
select is(pg_temp.act('b', $$insert into storage.objects (bucket_id, name) values ('avatars', @b || '/avatar.jpg')$$)
  || '|' || pg_temp.act('b', $$insert into storage.objects (bucket_id, name) values ('avatars', @c || '/avatar.jpg')$$)
  || '|' || pg_temp.act('b', $$insert into storage.objects (bucket_id, name) values ('post-images', @b || '/x/1.jpg')$$)
  || '|' || pg_temp.act('b', $$insert into storage.objects (bucket_id, name) values ('post-images', @a || '/x/1.jpg')$$),
  'ok|42501|ok|42501', 'a member uploads under their own folder only');
select is(pg_temp.seen('b', $$select 1 from storage.objects where bucket_id = 'avatars'$$) || '/'
  || pg_temp.seen('c', $$select 1 from storage.objects where bucket_id = 'avatars'$$), '1/0',
  'object rows of a public bucket are listed by their owner only');
create function pg_temp.chat_object(p_owner text) returns text language sql as $$
  select format($f$insert into storage.objects (bucket_id, name) values ('chat-media', @%s || '/' || %L || '/1.jpg')$f$,
                p_owner, (select id from public.chats where kind = 'direct'));
$$;
select is(pg_temp.act('d', pg_temp.chat_object('d')) || '|' || pg_temp.act('c', pg_temp.chat_object('c'))
  || '|' || pg_temp.act('d', pg_temp.chat_object('e'))
  || '|' || pg_temp.act('d', $$insert into storage.objects (bucket_id, name) values ('chat-media', @d || '/not-a-chat/1.jpg')$$),
  'ok|42501|42501|42501', 'chat media is uploaded by a member of the chat, under their own folder');
select is(pg_temp.seen('d', $$select 1 from storage.objects where bucket_id = 'chat-media'$$) || '/'
  || pg_temp.seen('e', $$select 1 from storage.objects where bucket_id = 'chat-media'$$) || '/'
  || pg_temp.seen('c', $$select 1 from storage.objects where bucket_id = 'chat-media'$$), '1/1/0',
  'chat media is readable by the members of the chat and nobody else');
insert into public.blocks (blocker_id, blocked_id) values ('00000000-0000-4000-8000-00000000000e', '00000000-0000-4000-8000-00000000000d');
select is(pg_temp.seen('d', $$select 1 from storage.objects where bucket_id = 'chat-media'$$), 0::bigint,
  'a block closes the chat''s media with the chat');
select is(pg_temp.act('c', 'delete from storage.objects') || (select count(*) from storage.objects), 'ok3',
  'a member cannot remove another member''s files');
select is(kc_access.storage_path_uuid('a/b/c', 2) is null
  and kc_access.storage_path_uuid('x/00000000-0000-4000-8000-00000000000a/f', 2) = '00000000-0000-4000-8000-00000000000a', true,
  'a path folder is a uuid or nothing');

-- ── Counter reconciliation ──────────────────────────────────────────────────
select is(kc_private.user_stats_reconcile() + kc_private.post_stats_reconcile(), 0, 'counters kept by triggers show no drift');
update public.user_stats set followers_count = 7, open_posts_public = 0 where user_id = '00000000-0000-4000-8000-00000000000a';
update public.post_stats set comments_count = 9 where post_id = '40000000-0000-4000-8000-000000000001';
delete from public.post_stats where post_id = '40000000-0000-4000-8000-000000000002';
select is(kc_private.user_stats_reconcile() || '/' || kc_private.post_stats_reconcile(), '2/3',
  'corrupted counters are detected: two of a member, one of a post, two of a post without a counter row');
select is((select followers_count || '/' || open_posts_public from public.user_stats where user_id = '00000000-0000-4000-8000-00000000000a')
  || ' ' || (select string_agg(reactions_count || '/' || comments_count || '/' || shares_count, ' ' order by post_id)
               from public.post_stats where post_id in ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002')),
  '1/4 1/2/1 1/0/1', 'and repaired from the source rows');
select is((select string_agg(counter_table || '.' || counter_name || ':' || stored_value || '>' || actual_value, ' '
                             order by counter_table, counter_name, stored_value)
             from ops.counter_drift),
  'post_stats.comments_count:9>2 post_stats.reactions_count:0>1 post_stats.shares_count:0>1 user_stats.followers_count:7>1 user_stats.open_posts_public:0>4',
  'each repair is recorded with the stored and the actual value');
select is(kc_private.user_stats_reconcile() + kc_private.post_stats_reconcile(), 0, 'a second run finds nothing');

select * from finish();
rollback;
