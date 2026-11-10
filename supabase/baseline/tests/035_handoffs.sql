-- Handoffs: a handoff is visible to its two members only and written by nobody directly;
-- each machine moves only along its edges and only for the right role; the generic flow,
-- the post management actions, closing, reopening, deleting, the address release and
-- ratings accept and refuse what the spec says; counters and outbox events follow.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Test shorthand inside SQL text: @a … @e are the members, #NN a post, ~NNx the handoff of
-- member x on post NN (a live one first).
create function pg_temp.expand(p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql text := p_sql;
  v_match text[];
begin
  for v_match in select regexp_matches(p_sql, '~(\d\d)([a-e])', 'g') loop
    v_sql := replace(v_sql, '~' || v_match[1] || v_match[2], coalesce(quote_literal((
      select h.id from public.post_handoffs h
       where h.post_id = ('10000000-0000-4000-8000-0000000000' || v_match[1])::uuid
         and h.recipient_id = ('00000000-0000-4000-8000-00000000000' || v_match[2])::uuid
       order by (h.status = 'cancelled'), h.ctid desc limit 1)), 'null') || '::uuid');
  end loop;
  v_sql := regexp_replace(v_sql, '@([a-e])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
  return regexp_replace(v_sql, '#(\d\d)', '''10000000-0000-4000-8000-0000000000\1''::uuid', 'g');
end;
$$;

-- Runs a statement as a signed-in member (or as `anon` when p_who is null). Returns 'ok',
-- the message of a P0001 error, or the SQLSTATE of any other error.
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
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- Rows a member can read with the given query.
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

-- One value read as the database owner.
create function pg_temp.val(p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  execute pg_temp.expand(p_sql) into v_value;
  return v_value;
end;
$$;

-- Moves a handoff as server code acting in a role would; returns like pg_temp.act.
create function pg_temp.move(p_handoff text, p_to text, p_role text, p_reason text default null)
returns text
language plpgsql
as $$
begin
  begin
    perform kc_private.handoff_move(pg_temp.val('select ' || p_handoff)::uuid, p_to, p_role, p_reason);
    return 'ok';
  exception when others then
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- 'given/received' counters of a member.
create function pg_temp.stats(p_who text)
returns text
language sql
as $$
  select items_given_count || '/' || items_received_count from public.user_stats
   where user_id = ('00000000-0000-4000-8000-00000000000' || p_who)::uuid;
$$;

-- Outbox events of a topic and kind (or audit action) addressed to / about a member.
create function pg_temp.events(p_topic text, p_kind text, p_who text default null)
returns bigint
language sql
as $$
  select count(*) from kc_private.outbox_events e
   where e.topic = p_topic and coalesce(e.payload ->> 'kind', e.payload ->> 'action') = p_kind
     and (p_who is null
          or coalesce(e.payload ->> 'recipient_id', e.payload ->> 'actor_id')
             = '00000000-0000-4000-8000-00000000000' || p_who);
$$;

select plan(158);

-- Alice owns the posts. Bob, Carol and Eve take them. Dan and Alice are blocked.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd', 'e']) x;
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-00000000000a');
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en)
select s, s, s from unnest(array['items', 'food', 'knowledge', 'rides', 'housing', 'time']) s;
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
select ('20000000-0000-4000-8000-00000000000' || n)::uuid, w, w || '_kind', w, w, 'either'
  from unnest(array['items', 'food', 'knowledge', 'rides', 'housing', 'time']) with ordinality as t (w, n);

-- 01-03 items · 04 item request · 05-06 food · 07 knowledge · 08 ride · 09 stay · 10-11 events
-- · 12 item draft · 13 item (follower-only later) · 14-16 items.
insert into public.posts (id, owner_id, world_slug, kind_id, post_type, direction, status, title, city_id)
select ('10000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-4000-8000-00000000000a', w,
       (select k.id from public.post_kinds k where k.world_slug = w), t, d,
       case n when 12 then 'draft' else 'open' end, 'post ' || n, 'c1'
  from (values
    (1, 'items', 'standard', 'offer'), (2, 'items', 'standard', 'offer'), (3, 'items', 'standard', 'offer'),
    (4, 'items', 'standard', 'request'), (5, 'food', 'standard', 'offer'), (6, 'food', 'standard', 'offer'),
    (7, 'knowledge', 'standard', 'offer'), (8, 'rides', 'ride', 'offer'), (9, 'housing', 'housing_stay', 'offer'),
    (10, 'time', 'event', 'offer'), (11, 'time', 'event', 'offer'), (12, 'items', 'standard', 'offer'),
    (13, 'items', 'standard', 'offer'), (14, 'items', 'standard', 'offer'), (15, 'items', 'standard', 'offer'),
    (16, 'items', 'standard', 'offer')
  ) as p (n, w, t, d);
update public.posts set time_window = tstzrange(now() + interval '1 day', now() + interval '2 days')
 where id = '10000000-0000-4000-8000-000000000010';
update public.posts set time_window = tstzrange(now() - interval '1 hour', now() + interval '2 hours')
 where id = '10000000-0000-4000-8000-000000000011';
insert into public.post_private_locations (post_id, street, street_number) values
  ('10000000-0000-4000-8000-000000000001', 'Herzl', '7');

-- ── Machines: every edge class ──────────────────────────────────────────────
insert into public.post_handoffs (post_id, recipient_id, status)
select ('10000000-0000-4000-8000-0000000000' || p)::uuid, '00000000-0000-4000-8000-00000000000e', s
  from (values ('07', 'reserved'), ('08', 'reserved'), ('09', 'reserved'), ('11', 'waitlisted')) v (p, s);
select is(pg_temp.val($$select string_agg(machine_id, ' ' order by post_id) from public.post_handoffs$$),
  'giving_handoff ride_booking housing_booking event_registration', 'the post type picks the machine of a handoff');
select is(pg_temp.val($$select count(*) from public.post_handoffs where owner_id = @a$$), '4',
  'the owner of a handoff is copied from its post');
select throws_ok($$insert into public.post_handoffs (post_id, recipient_id, status)
    values ('10000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-00000000000b', 'no_show')$$,
  'P0001', 'unknown_state', 'a ride booking cannot be created in a state its machine does not have');
select throws_ok($$insert into public.post_handoffs (post_id, recipient_id)
    values ('10000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-00000000000a')$$,
  '23514', null, 'the owner cannot hold a handoff on their own post');
select throws_ok($$insert into public.post_handoffs (post_id, recipient_id)
    values ('10000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-00000000000e')$$,
  '23505', null, 'a member holds one live handoff per post');

select is(pg_temp.move('~07e', 'confirmed', 'recipient'), 'forbidden_role', 'giving: only the owner approves');
select is(pg_temp.move('~07e', 'confirmed', null), 'forbidden_role', 'a move without a role is refused');
select is(pg_temp.move('~07e', 'confirmed', 'owner'), 'ok', 'giving: the owner approves');
select isnt(pg_temp.val($$select confirmed_at from public.post_handoffs where id = ~07e$$), null,
  'the confirmation time is stamped by the table');
select is(pg_temp.move('~07e', 'reserved', 'owner'), 'illegal_transition', 'giving: a confirmed handoff does not go back');
select is(pg_temp.move('~07e', 'bogus', 'owner'), 'unknown_state', 'giving: an unknown status is refused');
select is(pg_temp.move('~07e', 'no_show', 'owner'), 'forbidden_role', 'giving: only a sweep records a no-show');
select is(pg_temp.move('~07e', 'cancelled', 'recipient'), '23514', 'a cancellation needs a reason');
select is(pg_temp.move('~07e', 'handed_over', 'recipient'), 'ok', 'giving: either member marks the handover');
select is(pg_temp.move('~07e', 'cancelled', 'system', 'system'), 'forbidden_role',
  'giving: a delivery is taken back only by one of its members');

select is(pg_temp.move('~08e', 'cancelled', 'owner', 'declined'), 'ok', 'ride: the driver declines');
select is(pg_temp.move('~08e', 'reserved', 'recipient'), 'forbidden_role', 'ride: a passenger cannot reinstate');
select is(pg_temp.move('~08e', 'reserved', 'owner'), 'ok', 'ride: the driver reinstates a declined booking');
select is(pg_temp.val($$select cancel_reason is null and cancelled_at is null from public.post_handoffs where id = ~08e$$),
  'true', 'a reinstated booking forgets how it ended');
select is(pg_temp.move('~08e', 'no_show', 'owner'), 'unknown_state', 'ride: there is no no-show state');

select is(pg_temp.move('~09e', 'handed_over', 'owner'), 'illegal_transition', 'housing: a stay is approved before it is completed');
select is(pg_temp.move('~09e', 'confirmed', 'owner'), 'ok', 'housing: the host approves');
select is(pg_temp.move('~09e', 'no_show', 'recipient'), 'forbidden_role', 'housing: only the host reports a no-show');
select is(pg_temp.move('~09e', 'no_show', 'owner'), 'ok', 'housing: the host reports a no-show');

select is(pg_temp.move('~11e', 'confirmed', 'owner'), 'forbidden_role', 'event: only the system promotes the waiting list');
select is(pg_temp.move('~11e', 'confirmed', 'system'), 'ok', 'event: a freed seat promotes a waiting registration');
select is(pg_temp.move('~11e', 'no_show', 'owner'), 'ok', 'event: the organizer marks a no-show');
select is(pg_temp.move('~11e', 'handed_over', 'owner'), 'ok', 'event: the organizer corrects a no-show');
select is(pg_temp.val($$select no_show_at is null from public.post_handoffs where id = ~11e$$), 'true',
  'a corrected no-show loses its no-show time');
select is(pg_temp.stats('e'), '0/2', 'each completed handoff on an offer counts as received by the other member');

insert into public.handoff_booking_details (handoff_id, check_in_date, check_out_date, adults, message)
select h.id, current_date, current_date + 2, 2, 'hello' from public.post_handoffs h where h.machine_id = 'housing_booking';
select is(pg_temp.seen('a', 'select 1 from public.handoff_booking_details') || '/' || pg_temp.seen('e', 'select 1 from public.handoff_booking_details')
    || '/' || pg_temp.seen('c', 'select 1 from public.handoff_booking_details'), '1/1/0', 'stay details are read by the host and the guest only');
select is(pg_temp.act('e', 'update public.handoff_booking_details set adults = 1'), '42501', 'stay details are not writable from a device');
delete from public.post_handoffs;
delete from kc_private.outbox_events;
update public.user_stats set items_received_count = 0;

-- ── Generic flow: reserve → confirm → handed over ───────────────────────────
select is(pg_temp.act('b', $$select public.reserve_item_giving(#01, 'teleport')$$), 'invalid_pickup_mode',
  'an unknown pickup mode is refused');
select is(pg_temp.act('b', $$select public.reserve_item_giving(#01)$$), 'ok', 'a member asks for an item');
select is(pg_temp.val($$select status || ' ' || (confirm_by = now() + interval '24 hours') from public.post_handoffs where id = ~01b$$),
  'reserved true', 'the request waits for the owner for 24 hours');
select is(pg_temp.events('notification', 'giving_handoff_requested', 'a'), 1::bigint, 'the owner is told about the request');
select is(pg_temp.events('notification', 'giving_handoff_requested', 'b'), 0::bigint, 'the member who acted is not notified');
select is(pg_temp.act('c', $$select public.reserve_item_giving(#01)$$), 'item_already_reserved',
  'a competing request for the same item is refused');
select is(pg_temp.act('b', $$select public.reserve_item_giving(#01)$$), 'item_already_reserved',
  'a member cannot ask twice');
select is(pg_temp.act('a', $$select public.reserve_item_giving(#01)$$), 'own_listing', 'the owner cannot ask for their own item');
select is(pg_temp.act('d', $$select public.reserve_item_giving(#02)$$), 'listing_not_available',
  'a member in a blocked pair cannot ask');
select is(pg_temp.act('b', $$select public.reserve_item_giving(#05)$$), 'listing_not_available',
  'food is claimed, not requested');
select is(pg_temp.act('b', $$select public.reserve_item_giving(#04)$$), 'listing_not_available',
  'a request post cannot be reserved');
select is(pg_temp.act('b', $$select public.reserve_item_giving(#12)$$), 'listing_not_available', 'a draft cannot be reserved');
select is(pg_temp.act(null, $$select public.reserve_item_giving(#02)$$), '42501', 'a signed-out caller cannot reserve');

-- Access.
select is(pg_temp.seen('a', 'select 1 from public.post_handoffs'), 1::bigint, 'the owner sees the handoff');
select is(pg_temp.seen('b', 'select 1 from public.post_handoffs'), 1::bigint, 'the other member sees the handoff');
select is(pg_temp.seen('c', 'select 1 from public.post_handoffs'), 0::bigint, 'nobody else sees the handoff');
select is(pg_temp.act(null, 'select 1 from public.post_handoffs'), '42501', 'a signed-out caller cannot read handoffs');
select is(pg_temp.act('b', $$update public.post_handoffs set status = 'confirmed'$$), '42501',
  'a member cannot write a handoff directly');
select is(pg_temp.act('b', $$insert into public.post_handoffs (post_id, recipient_id) values (#02, @b)$$), '42501',
  'a member cannot insert a handoff directly');
select is(pg_temp.act('a', 'select kc_private.can_manage_post(#01)'), '42501', 'internal functions are not callable by members');

-- Guards while the request is live.
select is(pg_temp.act('a', 'select public.pause_post(#01)'), 'listing_has_active_handoff', 'a live handoff blocks a pause');
select is(pg_temp.act('a', 'select public.close_post_without_recipient(#01)'), 'listing_has_active_handoff',
  'a live handoff blocks closing without a recipient');
select is(pg_temp.act('b', 'select public.get_post_private_location(#01)'), 'post_not_found',
  'a waiting request does not release the exact address');
select is(pg_temp.act('b', 'select public.mark_giving_handed_over(~01b)'), 'handoff_not_confirmed',
  'a request is not handed over before it is approved');
select is(pg_temp.act('b', 'select public.rate_handoff(~01b, 5)'), 'handoff_not_found', 'a handoff is rated only after the handover');

select is(pg_temp.act('b', 'select public.confirm_item_handoff(~01b)'), 'handoff_not_found', 'the requester cannot approve');
select is(pg_temp.act('c', 'select public.confirm_item_handoff(~01b)'), 'handoff_not_found', 'a third member cannot approve');
select is(pg_temp.act('a', 'select public.confirm_item_handoff(~01b)'), 'ok', 'the owner approves');
select is(pg_temp.events('notification', 'giving_handoff_confirmed', 'b'), 1::bigint, 'the requester is told about the approval');

-- Exact address.
select is(pg_temp.seen('b', $$select 1 from public.get_post_private_location(#01) l where l.street = 'Herzl'$$), 1::bigint,
  'a confirmed handoff releases the exact address');
select is(pg_temp.events('audit', 'post_private_location_released', 'b'), 1::bigint, 'the release is audited');
select is(pg_temp.seen('a', $$select 1 from public.get_post_private_location(#01) l where l.street = 'Herzl'$$), 1::bigint,
  'the owner reads the address through the same RPC');
select is(pg_temp.events('audit', 'post_private_location_released'), 1::bigint, 'the owner''s own read is not a release');
select is(pg_temp.act('c', 'select public.get_post_private_location(#01)'), 'post_not_found', 'nobody else gets the address');
select is(pg_temp.seen('b', 'select 1 from public.post_private_locations'), 0::bigint,
  'the address table itself stays closed to the other member');

select is(pg_temp.act('c', 'select public.mark_giving_handed_over(~01b)'), 'handoff_not_found', 'a third member cannot complete');
select is(pg_temp.act('b', 'select public.mark_giving_handed_over(~01b)'), 'ok', 'the recipient marks the handover');
select is(pg_temp.val('select status from public.posts where id = #01'), 'closed_delivered', 'a single-taker post closes as delivered');
select is(pg_temp.stats('a') || ' ' || pg_temp.stats('b'), '1/0 0/1', 'the owner gave and the other member received');
select is(pg_temp.events('karma', 'handoff_completed'), 1::bigint, 'a karma event is recorded, not computed');
select is(pg_temp.events('notification', 'giving_handoff_completed', 'a') || '/' || pg_temp.events('notification', 'giving_handoff_completed', 'b'),
  '1/0', 'the other side is told about the handover');
select is(pg_temp.events('chat_system_message', 'post_closed'), 1::bigint, 'closing a post records a chat system message event');
update public.posts set visibility = 'OnlyMe' where id = '10000000-0000-4000-8000-000000000001';
select is(pg_temp.seen('b', 'select 1 from public.posts where id = #01') || '/' || pg_temp.seen('c', 'select 1 from public.posts where id = #01'),
  '1/0', 'the recipient keeps reading a delivered post outside its audience; others do not');

-- ── Ratings ─────────────────────────────────────────────────────────────────
select is(pg_temp.act('b', 'select public.rate_handoff(~01b, 6)'), 'invalid_rating', 'stars outside 1–5 are refused');
select is(pg_temp.act('c', 'select public.rate_handoff(~01b, 4)'), 'not_participant', 'only the two members rate a handoff');
select is(pg_temp.act('b', $$select public.rate_handoff(~01b, 5, ' thanks ')$$), 'ok', 'the recipient rates the owner');
select is(pg_temp.act('b', 'select public.rate_handoff(~01b, 1)'), 'handoff_already_rated', 'a member rates a handoff once');
select is(pg_temp.act('a', 'select public.rate_handoff(~01b, 4)'), 'ok', 'the owner rates the recipient');
select is(pg_temp.val($$select string_agg(stars || coalesce(comment, '-'), ' ' order by stars) from public.post_ratings
    where (rater_id, ratee_id) in ((@a, @b), (@b, @a))$$), '4- 5thanks', 'both ratings are stored, each about the other member');
-- The moderation module grants the table for its staff-only policy, so a member gets no rows.
select is(pg_temp.seen('b', 'select 1 from public.post_ratings'), 0::bigint, 'members cannot read ratings, not even their own');
select is(pg_temp.events('karma', 'rating_given'), 2::bigint, 'each rating records a karma event');

-- ── Reopen, close with a recipient, un-mark ─────────────────────────────────
select is(pg_temp.act('c', 'select public.reopen_post(#01)'), 'post_not_found', 'only a manager of the post reopens it');
select is(pg_temp.act('a', 'select public.reopen_post(#01)'), 'ok', 'the owner reopens a delivered post');
select is(pg_temp.val($$select p.status || ' ' || h.status || ' ' || h.cancel_reason from public.posts p
    join public.post_handoffs h on h.post_id = p.id where p.id = #01$$), 'open cancelled reopened',
  'reopening withdraws the recipient mark');
select is(pg_temp.stats('a') || ' ' || pg_temp.stats('b'), '0/0 0/0', 'reopening takes both counters back');
select is(pg_temp.events('karma', 'handoff_reverted'), 1::bigint, 'the reversal is recorded for karma');
select is(pg_temp.val($$select count(*) from kc_private.outbox_events
    where topic = 'notification' and payload #>> '{data,cancel_reason}' = 'reopened'$$), '0', 'reopening notifies nobody');

update public.posts set visibility = 'Public' where id = '10000000-0000-4000-8000-000000000001';
select is(pg_temp.act('c', 'select public.reserve_item_giving(#01)'), 'ok', 'a reopened item can be asked for again');
select is(pg_temp.act('c', 'select public.close_post_with_recipient(#01, @b)'), 'post_not_found', 'only a manager closes a post');
select is(pg_temp.act('a', 'select public.close_post_with_recipient(#01, @a)'), 'closure_recipient_not_in_chat',
  'the owner cannot name themselves');
select is(pg_temp.act('a', 'select public.close_post_with_recipient(#01, @d)'), 'closure_recipient_not_in_chat',
  'a blocked member cannot be named');
select is(pg_temp.act('a', 'select public.close_post_with_recipient(#07, @b)'), 'world_not_assignable',
  'a world with its own flow is not closed with one recipient');
select is(pg_temp.act('a', 'select public.close_post_with_recipient(#01, @b)'), 'ok', 'the owner closes naming a member');
select is(pg_temp.val($$select string_agg(status || coalesce(':' || cancel_reason, ''), ' ' order by status)
    from public.post_handoffs where post_id = #01 and recipient_id in (@b, @c) and cancel_reason is distinct from 'reopened'$$),
  'cancelled:superseded handed_over', 'the named member is handed over and the waiting one is superseded');
select is(pg_temp.events('notification', 'mark_recipient', 'b'), 1::bigint, 'the named member is told (FR-NOTIF-009)');
select is(pg_temp.events('notification', 'giving_handoff_cancelled', 'c'), 1::bigint, 'the superseded member is told');
select is(pg_temp.act('a', 'select public.close_post_with_recipient(#01, @c)'), 'closure_wrong_status', 'a closed post is not closed again');

select is(pg_temp.act('c', 'select public.recipient_unmark_self(#01)'), 'not_recipient_or_wrong_status',
  'only the named recipient removes the mark');
select is(pg_temp.act('b', 'select public.recipient_unmark_self(#01)'), 'ok', 'the recipient removes their mark');
select is(pg_temp.val($$select p.status || ' ' || (c.purge_after = now() + interval '7 days') || ' ' || c.delivered
    from public.posts p join public.post_closures c on c.post_id = p.id where p.id = #01$$),
  'deleted_no_recipient true true', 'the post is kept for seven days as a delivery without a recipient');
select is(pg_temp.stats('a') || ' ' || pg_temp.stats('b'), '1/0 0/0', 'the owner still gave; the member no longer received');
select is(pg_temp.events('notification', 'unmark_recipient', 'a') || '/' || pg_temp.events('audit', 'recipient_unmarked', 'b'),
  '1/1', 'the owner is told and the removal is audited');
select is(pg_temp.seen('a', 'select 1 from public.post_closures') || '/' || pg_temp.seen('b', 'select 1 from public.post_closures'),
  '1/0', 'closure state is the owner''s alone');
select is(pg_temp.act('a', 'select reopen_count from public.post_closures'), '42501', 'the reopen count is not readable');

update public.post_closures set purge_after = now() - interval '1 minute';
select is(pg_temp.val('select count(*) from kc_private.posts_due_for_purge()'), '1', 'a post past its grace period is due for purge');
select is(pg_temp.act('a', 'select public.reopen_post(#01)'), 'reopen_window_expired', 'a post past its grace period is not reopened');
update public.post_closures set purge_after = now() + interval '1 day';
select is(pg_temp.act('a', 'select public.reopen_post(#01)'), 'ok', 'a post inside its grace period is reopened');
select is(pg_temp.stats('a'), '0/0', 'reopening a delivery without recipient takes the owner''s count back');

-- Close without a recipient, delete, and the reopen flag.
select is(pg_temp.act('a', 'select public.close_post_without_recipient(#01)'), 'ok', 'the owner closes without naming anyone');
select is(pg_temp.stats('a'), '1/0', 'a closure without a recipient counts as given');
select is(pg_temp.act('a', 'select public.close_post_without_recipient(#01)'), 'closure_wrong_status', 'only an open post is closed');
select is((select count(*) from generate_series(1, 3) g
            where pg_temp.act('a', 'select public.reopen_post(#01)') = 'ok'
              and pg_temp.act('a', 'select public.close_post_without_recipient(#01)') = 'ok'), 3::bigint,
  'a post can be reopened and closed again');
select is(pg_temp.val('select reopen_count from public.post_closures where post_id = #01') || '/' || pg_temp.events('moderation', 'excessive_reopens'),
  '5/1', 'the fifth reopen flags the post for review (FR-CLOSURE-010)');

-- ── Food: claim, cancel, no-show ────────────────────────────────────────────
select is(pg_temp.act('b', 'select public.claim_food_giving(#05)'), 'ok', 'a member claims food');
select is(pg_temp.val('select status from public.post_handoffs where id = ~05b') || '/' || pg_temp.events('notification', 'giving_handoff_claimed', 'a'),
  'confirmed/1', 'a claim is confirmed at once and the owner is told');
select is(pg_temp.act('c', 'select public.claim_food_giving(#05)'), 'listing_not_available', 'a second claim is refused');
select is(pg_temp.act('c', 'select public.cancel_giving_handoff(~05b)'), 'handoff_not_found', 'a third member cannot cancel');
select is(pg_temp.act('b', 'select public.cancel_giving_handoff(~05b)'), 'ok', 'the claimer backs out');
select is(pg_temp.val('select cancel_reason from public.post_handoffs where id = ~05b'), 'recipient_cancelled', 'the reason names who cancelled');
select is(pg_temp.act('c', 'select public.claim_food_giving(#05)'), 'ok', 'the freed food can be claimed by another member');
select is(pg_temp.act('a', 'select public.cancel_giving_handoff(~05c)'), 'ok', 'the owner withdraws a confirmed handoff');
select is(pg_temp.val('select cancel_reason from public.post_handoffs where id = ~05c'), 'owner_cancelled', 'an owner cancellation is recorded as such');
select is(pg_temp.act('e', 'select public.claim_food_giving(#05)'), 'ok', 'a third claim succeeds');
update public.post_handoffs set pickup_window_start = now() - interval '5 hours', pickup_window_end = now() - interval '3 hours'
 where status = 'confirmed' and recipient_id = '00000000-0000-4000-8000-00000000000e';
select is(kc_private.handoff_no_show_sweep() || ' ' || pg_temp.val('select status from public.post_handoffs where id = ~05e'),
  '1 no_show', 'a pickup two hours past its window becomes a no-show');
update public.posts set expires_at = now() - interval '1 minute' where id = '10000000-0000-4000-8000-000000000006';
select is(pg_temp.act('b', 'select public.claim_food_giving(#06)'), 'listing_not_available', 'expired food cannot be claimed');

-- ── Decline, expiry sweep, post expiry ──────────────────────────────────────
select is(pg_temp.act('b', 'select public.reserve_item_giving(#02)'), 'ok', 'another request');
select is(pg_temp.act('a', 'select public.cancel_giving_handoff(~02b)'), 'ok', 'the owner declines a request');
select is(pg_temp.val('select cancel_reason from public.post_handoffs where id = ~02b') || '/' || pg_temp.events('notification', 'giving_handoff_declined', 'b'),
  'declined/1', 'a decline is recorded and pushed as a decline');
select is(pg_temp.act('c', 'select public.reserve_item_giving(#02)'), 'ok', 'the item can be asked for again');
update public.post_handoffs set confirm_by = now() - interval '1 minute' where status = 'reserved';
select is(kc_private.handoff_reservation_expiry_sweep() || ' ' || pg_temp.val('select cancel_reason from public.post_handoffs where id = ~02c'),
  '1 expired', 'an unanswered request lapses');
select is(pg_temp.events('notification', 'giving_handoff_expired'), 2::bigint, 'both members are told about the lapse');
select is(pg_temp.act('a', 'select public.pause_post(#02)'), 'ok', 'with no live handoff the owner pauses');
select is(pg_temp.act('a', 'select public.pause_post(#02)'), 'listing_wrong_status', 'only an open post is paused');
select is(pg_temp.act('b', 'select public.resume_post(#02)'), 'post_not_found', 'only a manager resumes');
select is(pg_temp.act('a', 'select public.resume_post(#02)') || ' ' || pg_temp.act('a', 'select public.publish_post(#12)')
    || ' ' || pg_temp.act('a', 'select public.publish_post(#12)'), 'ok ok listing_wrong_status', 'resume and publish move once');

-- ── Seats, waiting list, events ─────────────────────────────────────────────
select is(pg_temp.val($$select (kc_private.handoff_open(#08, @b, 'reserved', 3, 2)).seats$$), '2', 'two seats of three are booked');
select throws_ok($$select kc_private.handoff_open('10000000-0000-4000-8000-000000000008',
    '00000000-0000-4000-8000-00000000000c', 'reserved', 3, 2)$$, 'P0001', 'seats_exhausted',
  'a competing booking that does not fit is refused');
select is(pg_temp.val($$select (kc_private.handoff_open(#08, @c, 'reserved', 3, 1)).seats$$), '1', 'the last seat is booked');
select is(kc_private.handoff_seats_taken('10000000-0000-4000-8000-000000000008'), 3, 'three seats are taken');
select is(pg_temp.act('b', 'select public.cancel_giving_handoff(~08b)') || ' ' || pg_temp.act('a', 'select public.mark_giving_handed_over(~08b)'),
  'handoff_world_not_supported handoff_world_not_supported', 'a ride booking does not move through the generic RPCs');

select is(pg_temp.val($$select (kc_private.handoff_open(#10, @b, 'confirmed', 1)).status || ' '
    || (kc_private.handoff_open(#10, @c, 'waitlisted', 1)).status$$), 'confirmed waitlisted',
  'a full event takes a waiting registration');
select is(pg_temp.move('~10b', 'cancelled', 'recipient', 'recipient_cancelled') || ' '
    || kc_private.handoff_promote_waitlist('10000000-0000-4000-8000-000000000010', 1, 'confirmed')
    || ' ' || pg_temp.val('select status from public.post_handoffs where id = ~10c'), 'ok 1 confirmed',
  'a freed seat promotes the head of the waiting list');
select is(pg_temp.act('a', 'select public.pause_post(#10)') || ' ' || pg_temp.val('select cancel_reason from public.post_handoffs where id = ~10c')
    || ' ' || pg_temp.events('notification', 'event_registration_cancelled', 'c'), 'ok host_cancelled 1',
  'pausing an upcoming event cancels its registrations and tells the attendees (D131)');

-- ── Delete (any status, live handoffs included) and its undo ────────────────
select is(pg_temp.act('b', 'select public.delete_post(#08)'), 'post_not_found', 'only a manager deletes a post');
select is(pg_temp.act('a', 'select public.delete_post(#08)'), 'ok', 'the owner deletes a post with live bookings');
select is(pg_temp.val($$select p.status || ' ' || string_agg(distinct h.status || ':' || h.cancel_reason, ' ')
    from public.posts p join public.post_handoffs h on h.post_id = p.id where p.id = #08 group by p.status$$),
  'deleted_no_recipient cancelled:post_deleted', 'the bookings are cancelled because the post was deleted');
select is(pg_temp.events('notification', 'ride_booking_cancelled', 'b') + pg_temp.events('notification', 'ride_booking_cancelled', 'c'),
  2::bigint, 'each affected member is notified');
select is(pg_temp.act('a', 'select public.reopen_post(#08)') || ' ' || pg_temp.val('select status from public.posts where id = #08'),
  'ok open', 'a deletion is undone inside the grace period');
select is(pg_temp.act('a', 'select public.delete_post(#12)') || ' ' || pg_temp.val('select status from public.posts where id = #12'),
  'ok deleted_no_recipient', 'a published post is deleted by a status move');
select is(pg_temp.act('a', 'select public.delete_post(#12)'), 'listing_wrong_status', 'a deleted post is not deleted again');
select is(pg_temp.stats('a'), '1/0', 'a deleted post does not count as given');

-- A post that leaves the air by the system takes its live handoffs with it, except the
-- registrations of an event that already started.
select is(pg_temp.act('b', 'select public.reserve_item_giving(#03)'), 'ok', 'a request on a post about to expire');
insert into public.post_handoffs (post_id, recipient_id, status) values
  ('10000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-00000000000b', 'confirmed');
do $$
begin
  perform kc_private.post_move(p.id, 'expired', 'system') from public.posts p
   where p.id in ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000011');
end $$;
select is(pg_temp.val('select cancel_reason from public.post_handoffs where id = ~03b') || ' '
    || pg_temp.val('select status from public.post_handoffs where id = ~11b'), 'system confirmed',
  'expiry cancels a live handoff but keeps the registrations of a started event');

-- ── Account removal ─────────────────────────────────────────────────────────
delete from auth.users where id = '00000000-0000-4000-8000-00000000000b';
select is(pg_temp.val('select count(*) from public.post_handoffs where recipient_id = @b'), '0',
  'removing an account removes its handoffs');
select is(pg_temp.val($$select count(*) || ' ' || count(rater_id) || ' ' || count(handoff_id) from public.post_ratings where ratee_id = @a$$),
  '1 0 0', 'a rating given by the removed member stays, without its author');
select is(pg_temp.stats('a'), '1/0', 'the remaining member''s counters are untouched');

select * from finish();
rollback;
