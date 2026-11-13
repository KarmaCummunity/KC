-- Food and knowledge: a food offer states when the food expires, and the post's expiry
-- and urgency follow; the owner is alerted before it closes and the sweep closes it with
-- its claim. A knowledge offer has bookable slots that never overlap; a place is booked
-- once, a booked slot is not moved or removed, and the generic handoff flow completes the
-- session.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Shorthand inside SQL text: @a … @e members, #name the post titled `name`, ~name.x the
-- booking of member x on that post (a live one first). Posts and bookings are resolved
-- here, as the database owner, so a statement can name a row its caller cannot read.
create function pg_temp.expand(p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql text := p_sql;
  v_match text[];
begin
  for v_match in select regexp_matches(p_sql, '~(\w+)\.([a-e])', 'g') loop
    v_sql := replace(v_sql, '~' || v_match[1] || '.' || v_match[2], coalesce(quote_literal((
      select h.id from public.post_handoffs h join public.posts p on p.id = h.post_id
       where p.title = v_match[1] and h.recipient_id = ('00000000-0000-4000-8000-00000000000' || v_match[2])::uuid
       order by (h.status = 'cancelled'), h.ctid desc limit 1)), 'null') || '::uuid');
  end loop;
  for v_match in select regexp_matches(v_sql, '#(\w+)', 'g') loop
    v_sql := regexp_replace(v_sql, '#' || v_match[1] || '\M', coalesce(quote_literal((
      select p.id from public.posts p where p.title = v_match[1])), 'null') || '::uuid');
  end loop;
  return regexp_replace(v_sql, '@([a-e])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
end;
$$;

-- Runs a statement as a member (anon when null): 'ok', the P0001 message, or the SQLSTATE.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who,
      'role', case when p_who is null then 'anon' else 'authenticated' end)::text, true);
    perform set_config('role', case when p_who is null then 'anon' else 'authenticated' end, true);
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

-- One value read as a member, or as the database owner when p_who is null.
create function pg_temp.val(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
  v_value text;
begin
  if p_who is not null then
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
  execute v_sql into v_value;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return v_value;
end;
$$;

-- Notification events of a kind addressed to a member.
create function pg_temp.told(p_kind text, p_who text)
returns bigint
language sql
as $$
  select count(*) from kc_private.outbox_events e
   where e.topic = 'notification' and e.payload ->> 'kind' = p_kind
     and e.payload ->> 'recipient_id' = '00000000-0000-4000-8000-00000000000' || p_who;
$$;

-- Creates a food offer as a member, expiring after p_in, with extra detail fields.
create function pg_temp.food(p_who text, p_title text, p_in interval, p_extra jsonb default '{}', p_direction text default 'offer')
returns text
language sql
as $$
  select pg_temp.act(p_who, format(
    'select public.create_post_with_details(%L::jsonb, %L::jsonb)',
    jsonb_build_object('world_slug', 'food', 'direction', p_direction, 'title', p_title, 'city_id', 'c1',
      'kind_id', (select k.id from public.post_kinds k where k.slug = 'food')),
    jsonb_strip_nulls(jsonb_build_object('expires_at', now() + p_in)) || p_extra));
$$;

-- Adds a slot to the lesson as a member: starting after p_in, lasting p_length.
create function pg_temp.slot(p_who text, p_in interval, p_length interval default '1 hour', p_post text default 'k1')
returns text
language sql
as $$
  select pg_temp.act(p_who, format(
    'insert into public.post_knowledge_slots (post_id, starts_at, ends_at) values (#%s, %L, %L)',
    p_post, now() + p_in, now() + p_in + p_length));
$$;

select plan(40);

-- Alice gives. Bob and Carol take. Dan and Alice are blocked.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd', 'e']) x;
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-00000000000a');
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en)
select s, s, s from unnest(array['food', 'knowledge', 'items']) s;
insert into public.post_kinds (world_slug, slug, label_he, label_en, direction)
select s, s, s, s, 'either' from unnest(array['food', 'knowledge', 'items']) s;

-- ── Food offers ─────────────────────────────────────────────────────────────
select is(pg_temp.food('a', 'bad', null), 'food_expiry_required', 'a food offer states its expiry');
select is(pg_temp.food('a', 'bad', '-1 hour'), 'food_expiry_in_past', 'which lies in the future');
select is(pg_temp.food('a', 'bad', '1 day', '{"food_type":"mystery"}'), '23514', 'the food type is one of the list');
select is(pg_temp.food('a', 'bad', '1 day', '{}', 'request'), 'post_details_not_supported', 'a food request has no details');
select is(pg_temp.act('a', $$select public.create_post_with_details(jsonb_build_object('world_slug', 'items', 'direction', 'offer',
    'title', 'chair', 'city_id', 'c1', 'kind_id', (select id from public.post_kinds where slug = 'items')), '{}')$$),
  'post_details_not_supported', 'a world without a detail table uses a plain insert');
select is(pg_temp.food('a', 'f1', '80 hours', '{"food_type":"cooked","allergens":["nuts"],"kosher":true}')
    || pg_temp.food('a', 'f2', '10 hours'), 'okok', 'two food offers are published');
select is(pg_temp.val(null, $$select string_agg((expires_at = now() + case title when 'f1' then interval '80 hours' else interval '10 hours' end)
    || ':' || urgency_level, ' ' order by title) from public.posts where title in ('f1', 'f2')$$), 'true:2 true:3',
  'the post expires with the food and its urgency follows the expiry');
select is(pg_temp.act('a', $$insert into public.posts (owner_id, world_slug, kind_id, direction, title, city_id)
    select @a, 'food', id, 'offer', 'bare', 'c1' from public.post_kinds where slug = 'food'; set constraints all immediate$$),
  'post_details_required', 'a food offer cannot exist without its details');
select is(pg_temp.act('a', $$insert into public.posts (owner_id, world_slug, kind_id, direction, title, city_id)
    select @a, 'food', id, 'request', 'hungry', 'c1' from public.post_kinds where slug = 'food'; set constraints all immediate$$),
  'ok', 'a food request is a plain post and never expires');
select is(pg_temp.val('b', $$select count(*) from public.post_food_details$$) || pg_temp.val('d', $$select count(*) from public.post_food_details$$)
    || pg_temp.act(null, $$select 1 from public.post_food_details$$), '2042501', 'details follow the visibility of the post');
select is(pg_temp.act('b', $$select expiry_alerted_at from public.post_food_details$$), '42501', 'the alert stamp is not readable');
select is(pg_temp.act('b', $$update public.post_food_details set kosher = false where post_id = #f1$$)
    || pg_temp.act('a', $$update public.post_food_details set expires_at = now() + interval '20 hours' where post_id = #f1$$)
    || pg_temp.val(null, $$select f.kosher || '|' || (p.expires_at = now() + interval '20 hours') || '|' || p.urgency_level
         from public.post_food_details f join public.posts p on p.id = f.post_id where p.title = 'f1'$$), 'okoktrue|true|3',
  'only the giver edits; a moved expiry moves the post');
select is(pg_temp.act('a', $$update public.post_food_details set expires_at = now() - interval '1 hour' where post_id = #f1$$),
  'food_expiry_in_past', 'the expiry cannot be moved into the past');
select is(pg_temp.act('b', $$select public.claim_food_giving(#f2)$$) || '|' || pg_temp.val(null,
    $$select status || '|' || (pickup_window_end = now() + interval '10 hours') from public.post_handoffs where id = ~f2.b$$),
  'ok|confirmed|true', 'a claim is confirmed at once and is collected by the expiry');
update public.posts set urgency_level = 2 where title = 'f1';
select is(kc_private.food_expiry_alert_sweep() || '|' || kc_private.food_expiry_alert_sweep() || '|' || pg_temp.told('food_expiring', 'a')
    || '|' || pg_temp.val(null, $$select urgency_level from public.posts where title = 'f1'$$), '2|0|2|3',
  'offers inside 24 hours are alerted once and urgency is refreshed');
select is(pg_temp.act('a', $$update public.post_food_details set expires_at = now() + interval '5 hours' where post_id = #f1$$)
    || '|' || kc_private.food_expiry_alert_sweep(), 'ok|1', 'a moved expiry is alerted again');
update public.posts set expires_at = now() - interval '1 minute' where title = 'f2';
select is(kc_private.post_expiry_sweep() || '|' || pg_temp.val(null, $$select p.status || '|' || h.status || ':' || h.cancel_reason
    from public.posts p join public.post_handoffs h on h.post_id = p.id where p.title = 'f2'$$) || '|' || pg_temp.told('food_expired', 'a'),
  '1|expired|cancelled:not_completed|1', 'the sweep expires the offer, ends its claim and tells the giver');
select is(pg_temp.act('c', $$select public.claim_food_giving(#f2)$$), 'listing_not_available', 'an expired offer is not claimed');

-- ── Knowledge slots ─────────────────────────────────────────────────────────
insert into public.posts (owner_id, world_slug, kind_id, direction, title, city_id)
select '00000000-0000-4000-8000-00000000000a', k.world_slug, k.id, 'offer', t.title, 'c1'
  from (values ('k1', 'knowledge'), ('chair', 'items')) t (title, world)
  join public.post_kinds k on k.slug = t.world;
select is(pg_temp.slot('a', '1 day') || pg_temp.slot('a', '2 days', '2 hours'), 'okok', 'the giver adds two slots');
select is(pg_temp.val(null, $$select expires_at = now() + interval '2 days 2 hours 30 minutes' from public.posts where title = 'k1'$$),
  'true', 'the offer expires 30 minutes after its last slot');
select is(pg_temp.slot('a', '1 day 30 minutes'), '23P01', 'slots of a post never overlap');
select is(pg_temp.slot('a', '3 days', '5 minutes'), '23514', 'a slot lasts at least 15 minutes');
select is(pg_temp.slot('a', '-1 hour'), 'slot_started', 'a slot starts in the future');
select is(pg_temp.slot('b', '4 days'), '42501', 'only the giver adds slots');
select is(pg_temp.slot('a', '4 days', '1 hour', 'chair'), 'post_details_mismatch', 'slots belong to knowledge offers');
select is(pg_temp.val('b', $$select count(*) from public.post_knowledge_slots$$) || pg_temp.val('d', $$select count(*) from public.post_knowledge_slots$$)
    || pg_temp.act(null, $$select 1 from public.post_knowledge_slots$$), '2042501', 'slots follow the visibility of the post');
select is(pg_temp.act('b', $$select public.book_knowledge_seat((select id from public.post_knowledge_slots order by starts_at limit 1))$$)
    || '|' || pg_temp.val(null, $$select status || '|' || machine_id || '|' || (confirm_by = now() + interval '24 hours') || '|'
         || (slot_starts_at = now() + interval '1 day') from public.post_handoffs where id = ~k1.b$$),
  'ok|reserved|giving_handoff|true|true', 'a learner books a place; the giver has 24 hours');
select is(pg_temp.told('knowledge_booking_requested', 'a') || '|' || pg_temp.told('giving_handoff_requested', 'a'), '1|0',
  'the giver is told about a booking in the knowledge wording, not the item handoff one');
select is(pg_temp.act('c', $$select public.book_knowledge_seat((select id from public.post_knowledge_slots order by starts_at limit 1))$$),
  'slots_exhausted', 'a full slot is not booked');
select is(pg_temp.act('a', $$select public.book_knowledge_seat((select id from public.post_knowledge_slots order by starts_at desc limit 1))$$),
  'own_listing', 'the giver does not book');
select is(pg_temp.act('d', format($$select public.book_knowledge_seat(%L)$$,
    (select id from public.post_knowledge_slots order by starts_at limit 1))), 'listing_not_available',
  'a blocked member cannot book, even knowing the slot');
select is(pg_temp.act('b', $$select public.book_knowledge_seat((select id from public.post_knowledge_slots order by starts_at desc limit 1))$$),
  'item_already_reserved', 'one live booking per learner and offer');
select is(pg_temp.act('a', $$delete from public.post_knowledge_slots where starts_at = now() + interval '1 day'$$)
    || '|' || pg_temp.act('a', $$update public.post_knowledge_slots set starts_at = starts_at + interval '10 minutes'
         where starts_at = now() + interval '1 day'$$), 'knowledge_slot_has_booking|knowledge_slot_has_booking',
  'a booked slot is neither removed nor moved');
select is(pg_temp.act('a', $$update public.post_knowledge_slots set capacity = 2 where starts_at = now() + interval '1 day'$$)
    || pg_temp.act('c', $$select public.book_knowledge_seat((select id from public.post_knowledge_slots order by starts_at limit 1))$$),
  'okok', 'more places admit another learner');
select is(pg_temp.act('a', $$update public.post_knowledge_slots set capacity = 1 where starts_at = now() + interval '1 day'$$),
  'knowledge_slot_has_booking', 'places are not cut below the bookings');
select is(pg_temp.act('a', $$select public.confirm_item_handoff(~k1.b)$$) || pg_temp.act('b', $$select public.mark_giving_handed_over(~k1.b)$$)
    || pg_temp.act('c', $$select public.cancel_giving_handoff(~k1.c)$$)
    || '|' || pg_temp.val(null, $$select status from public.posts where title = 'k1'$$), 'okokok|open',
  'the generic flow approves, completes and cancels a session; the offer stays open');
update public.post_knowledge_slots set starts_at = now() - interval '10 minutes', ends_at = now() + interval '50 minutes'
 where starts_at = now() + interval '2 days';
select is(pg_temp.act('c', $$select public.book_knowledge_seat((select id from public.post_knowledge_slots order by starts_at limit 1))$$),
  'slot_started', 'a slot that started is not booked');
select is(pg_temp.act('a', $$delete from public.post_knowledge_slots where starts_at < now()$$) || '|' || pg_temp.val(null,
    $$select (select count(*) from public.post_knowledge_slots) || '|' || (expires_at = now() + interval '1 day 1 hour 30 minutes')
        from public.posts where title = 'k1'$$), 'ok|1|true', 'an unbooked slot is removed and the expiry follows');
select is(pg_temp.act('a', $$insert into public.post_knowledge_slots (post_id, starts_at, ends_at)
    select #k1, now() + n * interval '3 days', now() + n * interval '3 days' + interval '1 hour' from generate_series(1, 20) n$$),
  'knowledge_slots_limit', 'at most twenty slots per offer');
delete from auth.users where id = '00000000-0000-4000-8000-00000000000a';
select is((select count(*) from public.post_knowledge_slots) + (select count(*) from public.post_food_details), 0::bigint,
  'removing the giver removes slots and food details, booked or not');

select * from finish();
rollback;
