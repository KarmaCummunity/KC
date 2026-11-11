-- Social graph: follow edges keep the counters, lists are readable by members, and a block
-- hides both members from each other without revealing who blocked whom.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs one statement as an API role and returns the number of rows it returned or changed.
create function pg_temp.rows_as(p_role text, p_user_id uuid, p_sql text)
returns bigint
language plpgsql
as $$
declare
  v_rows bigint;
begin
  perform set_config(
    'request.jwt.claims', jsonb_build_object('sub', p_user_id, 'role', p_role)::text, true);
  perform set_config('role', p_role, true);
  execute p_sql;
  get diagnostics v_rows = row_count;
  perform set_config('role', 'none', true);
  return v_rows;
end;
$$;

-- Counters of one member as 'followers/following'.
create function pg_temp.counters(p_user_id uuid)
returns text
language sql
as $$
  select followers_count || '/' || following_count from public.user_stats where user_id = p_user_id;
$$;

select plan(20);

-- Three active members (Google accounts start active).
insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test', '{"provider":"google"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test', '{"provider":"google"}'),
  ('00000000-0000-4000-8000-00000000000c', 'carol@example.test', '{"provider":"google"}');

-- ── Follows ─────────────────────────────────────────────────────────────────
insert into public.follows (follower_id, followed_id) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b'),
  ('00000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-00000000000b');
select is(pg_temp.counters('00000000-0000-4000-8000-00000000000b'), '2/0', 'a new edge raises the followed counter');
select is(pg_temp.counters('00000000-0000-4000-8000-00000000000a'), '0/1', 'a new edge raises the follower counter');

select throws_ok(
  $$insert into public.follows (follower_id, followed_id)
    values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a')$$,
  '23514', null, 'a member cannot follow themselves');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000b',
      'insert into public.follows (follower_id, followed_id) values (''00000000-0000-4000-8000-00000000000b'', ''00000000-0000-4000-8000-00000000000a'')')$$,
  '42501', null, 'a follow edge cannot be inserted from a device');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a', 'select 1 from public.follows'),
  2::bigint, 'every member can read follow lists');
select throws_ok(
  $$select pg_temp.rows_as('anon', null, 'select 1 from public.follows')$$,
  '42501', null, 'a signed-out caller cannot read follow lists');

select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a', 'delete from public.follows'),
  1::bigint, 'a delete removes only edges the caller is part of (unfollow)');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000b', 'delete from public.follows'),
  1::bigint, 'the followed member can remove a follower');
select is(pg_temp.counters('00000000-0000-4000-8000-00000000000b'), '0/0', 'removing edges lowers the counters');

-- ── Blocks ──────────────────────────────────────────────────────────────────
insert into public.follows (follower_id, followed_id) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000c'),
  ('00000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000a');

select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
    $$insert into public.blocks (blocker_id, blocked_id)
      values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000c')$$),
  1::bigint, 'a member can block another member');
select throws_ok(
  $$select pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a',
      'insert into public.blocks (blocker_id, blocked_id) values (''00000000-0000-4000-8000-00000000000b'', ''00000000-0000-4000-8000-00000000000c'')')$$,
  '42501', null, 'a member cannot create a block on behalf of someone else');

select is((select count(*) from public.follows), 1::bigint, 'blocking removes follows in both directions only between the pair');
select is(pg_temp.counters('00000000-0000-4000-8000-00000000000a'), '1/0', 'counters follow the edges removed by a block');

select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a', 'select 1 from public.users'),
  2::bigint, 'the blocker no longer sees the blocked member');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000c', 'select 1 from public.users'),
  2::bigint, 'the blocked member no longer sees the blocker');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000b', 'select 1 from public.users'),
  3::bigint, 'a third member is unaffected');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000c', 'select 1 from public.blocks'),
  0::bigint, 'the blocked member cannot see who blocked them');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000c', 'delete from public.blocks'),
  0::bigint, 'the blocked member cannot lift the block');

select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a', 'delete from public.blocks'),
  1::bigint, 'the blocker can lift the block');
select is(pg_temp.rows_as('authenticated', '00000000-0000-4000-8000-00000000000a', 'select 1 from public.users'),
  3::bigint, 'after unblocking the member is visible again');

select * from finish();
rollback;
