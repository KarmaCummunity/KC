-- Housing trust counts and knowledge slot seats: every member who can read a profile sees
-- that member's completed stays (as host and as guest, completed only, housing only), and
-- every reader of a knowledge offer sees the places left in each slot, without reading
-- anyone's booking; a hidden profile or post gives no row; signed-out callers get nothing.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Shorthand inside SQL text: @a … @e members, #name the post titled `name`.
create function pg_temp.expand(p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql text := p_sql;
  v_match text[];
begin
  for v_match in select regexp_matches(p_sql, '#(\w+)', 'g') loop
    v_sql := regexp_replace(v_sql, '#' || v_match[1] || '\M', coalesce(quote_literal((
      select p.id from public.posts p where p.title = v_match[1])), 'null') || '::uuid');
  end loop;
  return regexp_replace(v_sql, '@([a-e])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
end;
$$;

-- Runs a statement as a member (anon when null) and returns its one value as text, the
-- P0001 message, or the SQLSTATE.
create function pg_temp.as_member(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
  v_value text;
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who,
      'role', case when p_who is null then 'anon' else 'authenticated' end)::text, true);
    perform set_config('role', case when p_who is null then 'anon' else 'authenticated' end, true);
    execute v_sql into v_value;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return coalesce(v_value, 'none');
  exception when others then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- Completed stays of members a, b, c, e as one member sees them: `a:2 b:1 …`.
create function pg_temp.stays(p_who text)
returns text
language sql
as $$
  select pg_temp.as_member(p_who, $q$select string_agg(right(user_id::text, 1) || ':' || completed_stays, ' ' order by user_id)
    from public.housing_completed_stays(array[@a, @b, @c, @e, gen_random_uuid()])$q$);
$$;

-- Slots of the lesson as one member sees them: `capacity|taken|left` per slot, in time order.
create function pg_temp.seats(p_who text)
returns text
language sql
as $$
  select pg_temp.as_member(p_who, $q$select string_agg(concat_ws('|', capacity, seats_taken, seats_left), ' ' order by starts_at)
    from public.knowledge_slot_seats(#k1)$q$);
$$;

-- A handoff written as the database owner, in the given state.
create function pg_temp.handoff(p_post text, p_who text, p_status text)
returns void
language sql
as $$
  insert into public.post_handoffs (post_id, owner_id, recipient_id, status, cancel_reason)
  select p.id, p.owner_id, ('00000000-0000-4000-8000-00000000000' || p_who)::uuid, p_status,
         case p_status when 'cancelled' then 'declined' end
    from public.posts p where p.title = p_post;
$$;

select plan(10);

-- Alice hosts and teaches. Bob and Carol stay and learn. Dan blocked Alice. Eve is suspended.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd', 'e']) x;
update public.users set is_active = false where id = '00000000-0000-4000-8000-00000000000e';
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-00000000000a');
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) select s, s, s from unnest(array['housing', 'knowledge']) s;
insert into public.post_kinds (world_slug, slug, label_he, label_en, direction)
select s, s, s, s, 'either' from unnest(array['housing', 'knowledge']) s;

-- Two stay offers of Alice and one of Eve, and a lesson of Alice. The stay details a
-- stay offer needs are checked at commit, which this test never reaches.
insert into public.posts (owner_id, world_slug, kind_id, post_type, direction, title, city_id)
select ('00000000-0000-4000-8000-00000000000' || t.owner)::uuid, k.world_slug, k.id, t.post_type, 'offer', t.title, 'c1'
  from (values ('a', 'h1', 'housing', 'housing_stay'), ('a', 'h2', 'housing', 'housing_stay'),
               ('e', 'h3', 'housing', 'housing_stay'), ('a', 'k1', 'knowledge', 'standard')) t (owner, title, world, post_type)
  join public.post_kinds k on k.slug = t.world;
select pg_temp.handoff('h1', 'b', 'handed_over');
select pg_temp.handoff('h1', 'c', 'cancelled');
select pg_temp.handoff('h2', 'c', 'handed_over');
select pg_temp.handoff('h2', 'b', 'no_show');
select pg_temp.handoff('h3', 'b', 'handed_over');
select pg_temp.handoff('k1', 'b', 'handed_over');

-- ── Housing trust counts ────────────────────────────────────────────────────
select is(m.val_check, 'housing_booking', 'every handoff of a stay offer runs on the housing machine')
  from (select string_agg(distinct machine_id, ',') as val_check from public.post_handoffs h
          join public.posts p on p.id = h.post_id where p.world_slug = 'housing') m;
select is(pg_temp.stays('b'), 'a:2 b:2 c:1',
  'completed stays count as host and as guest; cancelled, no-show, other worlds and suspended profiles do not');
select is(pg_temp.stays('d'), 'b:2 c:1', 'a member who blocked another does not read their count');
select is(pg_temp.as_member('b', $$select count(*) from public.post_handoffs where machine_id = 'housing_booking'$$), '3',
  'while the bookings themselves stay visible to their two members only');
select is(pg_temp.stays('e'), 'a:2 b:2 c:1 e:1', 'a suspended member still reads their own count');
select is(pg_temp.stays(null) || pg_temp.as_member(null, $$select kc_access.housing_completed_stays_of(@a)$$), '4250142501',
  'signed-out callers get nothing');

-- ── Knowledge slot seats ────────────────────────────────────────────────────
insert into public.post_knowledge_slots (post_id, starts_at, ends_at, capacity)
select p.id, now() + s.starts_in, now() + s.starts_in + interval '1 hour', s.capacity
  from public.posts p, (values (interval '1 day', 2), (interval '2 days', 1)) s (starts_in, capacity)
 where p.title = 'k1';
select is(pg_temp.as_member('b', $$select count(*) from public.book_knowledge_seat((select id from public.post_knowledge_slots order by starts_at limit 1))$$)
    || pg_temp.as_member('c', $$select count(*) from public.book_knowledge_seat((select id from public.post_knowledge_slots order by starts_at limit 1))$$),
  '11', 'two learners book the first slot');
select is(pg_temp.seats('a') || ' / ' || pg_temp.seats('b'), '2|2|0 1|0|1 / 2|2|0 1|0|1',
  'the giver and a learner see the places held and left in every slot');
select is(pg_temp.seats('d') || '|' || pg_temp.seats(null), 'none|42501',
  'a member who cannot read the offer gets no slot; signed-out callers get nothing');
select is(pg_temp.as_member('c', $$select count(*) from public.cancel_giving_handoff((select id from public.post_handoffs
      where recipient_id = @c and slot_starts_at is not null))$$) || '|' || pg_temp.seats('c'),
  '1|2|1|1 1|0|1', 'a cancelled booking frees its place');

select * from finish();
rollback;
