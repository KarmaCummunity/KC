-- Karma: points come only from the consumer of outbox topic `karma`, at configured values;
-- an event performed twice pays once; an undone handoff is reversed; caps hold; the ledger
-- is private, append-only and reconciled against the total.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs a statement as member @x (anon when null): 'ok', a P0001 message, or the SQLSTATE.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_role constant text := case when p_who is null then 'anon' else 'authenticated' end;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', v_role)::text, true);
  perform set_config('role', v_role, true);
  execute regexp_replace(p_sql, '@([a-e])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
  perform set_config('role', 'none', true);
  return 'ok';
exception when others then
  perform set_config('role', 'none', true);
  return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
end;
$$;

-- Rows member @x reads with a query.
create function pg_temp.seen(p_who text, p_sql text)
returns bigint
language plpgsql
as $$
declare
  v_rows bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute 'select count(*) from (' || p_sql || ') q' into v_rows;
  perform set_config('role', 'none', true);
  return v_rows;
end;
$$;

-- A member's karma total.
create function pg_temp.karma(p_who text)
returns integer
language sql
as $$
  select karma_points from public.user_stats
   where user_id = ('00000000-0000-4000-8000-00000000000' || p_who)::uuid;
$$;

select plan(32);

insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd']) x;
insert into public.admin_role_grants (user_id, role) values ('00000000-0000-4000-8000-00000000000d', 'super_admin');
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
values ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'item', 'either');
-- Alice offers an item she values at 400 ILS.
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, title, city_id, details)
values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'items',
        '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'a chair', 'c1', '{"estimated_value": 400}');

-- ── A completed handoff pays both members, once ─────────────────────────────
select is(pg_temp.act('b', $$select public.reserve_item_giving('10000000-0000-4000-8000-000000000001')$$), 'ok', 'Bob asks for the item');
select is(pg_temp.act('a', $$select public.confirm_item_handoff((select id from public.post_handoffs))$$), 'ok', 'Alice approves');
select is(pg_temp.act('b', $$select public.mark_giving_handed_over((select id from public.post_handoffs))$$), 'ok', 'Bob marks the handover');
select is(pg_temp.karma('a'), 0, 'the handover itself writes no karma');
select is(kc_private.karma_process(), 1, 'the consumer performs the handoff event');
select is(pg_temp.karma('a'), 28, 'the giver earns 20 and the value bonus (400 / 50 = 8)');
select is(pg_temp.karma('b'), 15, 'the receiver earns 15');

select is(kc_private.karma_deliver((select max(id) from kc_private.outbox_events where topic = 'karma')), 0,
  'performing the same event again pays nothing');
select is((select count(*) from public.karma_ledger), 3::bigint, 'and writes no entry');

-- ── Privacy ──────────────────────────────────────────────────────────────────
select is(pg_temp.seen('a', 'select 1 from public.karma_ledger'), 2::bigint, 'a member reads their own entries');
select is(pg_temp.seen('c', 'select 1 from public.karma_ledger'), 0::bigint, 'and nobody else''s');
select is(pg_temp.seen('d', 'select 1 from public.karma_ledger'), 3::bigint, 'the super admin reads every entry');
select is(pg_temp.act(null, 'select 1 from public.karma_ledger'), '42501', 'a signed-out caller reads nothing');
select is(pg_temp.act('a', $$insert into public.karma_ledger (user_id, event_type, points, subject, reference)
  values (@a, 'gift', 100, 's', 'r')$$), '42501', 'a member cannot write the ledger');
select is(pg_temp.act('c', 'select karma_points from public.user_stats where user_id = @a'), '42501',
  'another member''s karma total is not readable');
select is(pg_temp.seen('a', 'select 1 where public.my_karma_points() = 28'), 1::bigint, 'a member reads their own total');
select is(pg_temp.act('a', $$select kc_private.karma_apply(@a, 'gift', 100, 's', 'r')$$), '42501',
  'the internal functions are not callable from a device');

-- ── Rating, then the handoff is undone ───────────────────────────────────────
select is(pg_temp.act('b', $$select public.rate_handoff((select id from public.post_handoffs), 5)$$), 'ok', 'Bob rates Alice');
select is(pg_temp.act('a', $$select public.reopen_post('10000000-0000-4000-8000-000000000001')$$), 'ok', 'Alice reopens the post');
select is(kc_private.karma_process(), 2, 'the rating and the reversal are performed');
select is(pg_temp.karma('a') || '/' || pg_temp.karma('b'), '0/2',
  'the handoff points are taken back from both; the rating points stay');
select is((select count(*) from public.karma_ledger where event_type = 'reversal' and points < 0), 3::bigint,
  'each reversed award is its own negative entry');
select is(kc_private.karma_deliver((select max(id) from kc_private.outbox_events
                                     where topic = 'karma' and payload ->> 'kind' = 'handoff_reverted')), 0,
  'a repeated reversal takes nothing more');

-- ── Caps and penalties ───────────────────────────────────────────────────────
do $$
begin
  perform kc_private.outbox_enqueue('karma', jsonb_build_object('kind', 'award', 'event_type', 'challenge_opened',
            'context', 'personal', 'user_id', '00000000-0000-4000-8000-00000000000c', 'subject', 'challenge:' || n || ':opened'))
     from generate_series(1, 3) n;
  perform kc_private.outbox_enqueue('karma', '{"kind": "mystery"}');
end $$;
select is(kc_private.karma_process(), 3, 'a batch goes on past an event it cannot perform');
select is(pg_temp.karma('c'), 4, 'the daily cap of an event type stops the third award');
select is((select last_error from kc_private.outbox_events where payload ->> 'kind' = 'mystery'), 'invalid_karma_event',
  'the unknown event is kept with its error for a retry');
select is(kc_private.karma_award('00000000-0000-4000-8000-00000000000c', 'handoff_giver', 'housing_stay',
                                 'handoff:x:giver', 'event:x', '{"night": 10}'), 210,
  'a per-unit value is capped at its maximum units (7 nights)');
select is(kc_private.karma_apply('00000000-0000-4000-8000-00000000000a', 'penalty', -5, 'post:x', 'event:y'), 0,
  'a penalty never takes a total below zero');

-- ── Append-only and reconciliation ───────────────────────────────────────────
select throws_ok($$update public.karma_ledger set points = 1000$$, 'P0001', 'append_only', 'an entry is never changed');
update public.user_stats set karma_points = 999 where user_id = '00000000-0000-4000-8000-00000000000b';
select is(kc_private.karma_reconcile(), 1, 'reconciliation finds the one drifted total');
select is(pg_temp.karma('b') || ':' || (select stored || '>' || computed from ops.karma_drift), '2:999>2',
  'restores it from the ledger and records the drift');

delete from auth.users where id = '00000000-0000-4000-8000-00000000000c';
select is((select count(*) from public.karma_ledger where user_id = '00000000-0000-4000-8000-00000000000c'), 0::bigint,
  'removing a member removes their ledger');

select * from finish();
rollback;
