-- supabase/tests/0202_post_actor_identity_guest_visible.sql
-- Regression for migration 0202 (TD-81).
--
-- The post_actor_identity SELECT policy used to require auth.uid() IS NOT NULL,
-- hiding ALL rows from guests. 0202 drops that guard so visibility tracks
-- is_post_visible_to(p, auth.uid()) exactly: a guest sees an actor-identity row
-- iff it can see the post (Public open → yes; OnlyMe/private → no).
--
-- Runs under anon / authenticated roles (the harness is otherwise postgres,
-- which bypasses RLS). Rolled-back transaction; ON_ERROR_STOP=1 fails CI on any
-- raise.

begin;

-- random ids so the handle_new_user default share_handle never collides.
create temp table t_td81(role text primary key, id uuid) on commit drop;

do $seed$
declare v_owner uuid := gen_random_uuid(); v_stranger uuid := gen_random_uuid(); v_city text;
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role) values
    (v_owner,    'td81o_'||substr(v_owner::text,1,8)||'@test.local',    now(), jsonb_build_object('full_name','O'), jsonb_build_object('provider','email'), 'authenticated','authenticated'),
    (v_stranger, 'td81s_'||substr(v_stranger::text,1,8)||'@test.local', now(), jsonb_build_object('full_name','S'), jsonb_build_object('provider','email'), 'authenticated','authenticated');
  update public.users set share_handle='td81o_'||substr(v_owner::text,1,8),    display_name='O', privacy_mode='Public', account_status='active' where user_id=v_owner;
  update public.users set share_handle='td81s_'||substr(v_stranger::text,1,8), display_name='S', privacy_mode='Public', account_status='active' where user_id=v_stranger;

  select city_id into v_city from public.cities limit 1;
  if v_city is null then raise exception 'PRECONDITION FAILED: no cities seeded'; end if;

  insert into public.posts (post_id, owner_id, type, status, visibility, title, description, category, city, street, street_number) values
    ('00000000-0000-0000-0000-0008100000c1', v_owner, 'Give', 'open', 'Public', 'pub',  'd', 'Other', v_city, 'Herzl', '1'),
    ('00000000-0000-0000-0000-0008100000c2', v_owner, 'Give', 'open', 'OnlyMe', 'only', 'd', 'Other', v_city, 'Herzl', '2');
  insert into public.post_actor_identity (post_id, user_id, identity_visibility, surface_visibility) values
    ('00000000-0000-0000-0000-0008100000c1', v_owner, 'Public', 'Public'),
    ('00000000-0000-0000-0000-0008100000c2', v_owner, 'Public', 'Public');

  insert into t_td81 values ('owner', v_owner), ('stranger', v_stranger);
end;
$seed$;

create or replace function pg_temp.assert_counts(p_expect_pub int, p_expect_only int, p_who text)
returns void language plpgsql as $$
declare n_pub int; n_only int;
begin
  select count(*) into n_pub  from public.post_actor_identity where post_id='00000000-0000-0000-0000-0008100000c1';
  select count(*) into n_only from public.post_actor_identity where post_id='00000000-0000-0000-0000-0008100000c2';
  if n_pub <> p_expect_pub then
    raise exception 'ASSERT FAILED (%): expected % identity row(s) for Public post, got %', p_who, p_expect_pub, n_pub;
  end if;
  if n_only <> p_expect_only then
    raise exception 'ASSERT FAILED (%): expected % identity row(s) for OnlyMe post, got %', p_who, p_expect_only, n_only;
  end if;
end $$;
-- Called below under `set local role`: new functions are owner-only by default (0520).
grant execute on function pg_temp.assert_counts(integer, integer, text) to public;

-- Guest (anon, NULL uid): sees the Public post's identity, NOT the OnlyMe one.
select set_config('request.jwt.claims', jsonb_build_object('role','anon')::text, true);
set local role anon;
select pg_temp.assert_counts(1, 0, 'anon');
reset role;

-- Authenticated stranger: same — Public visible, OnlyMe hidden.
select set_config('request.jwt.claims', jsonb_build_object('sub',(select id from t_td81 where role='stranger'),'role','authenticated')::text, true);
set local role authenticated;
select pg_temp.assert_counts(1, 0, 'stranger');
reset role;

-- Owner: sees both (owner is always visible to itself via is_post_visible_to).
select set_config('request.jwt.claims', jsonb_build_object('sub',(select id from t_td81 where role='owner'),'role','authenticated')::text, true);
set local role authenticated;
select pg_temp.assert_counts(1, 1, 'owner');
reset role;

do $$ begin raise notice '✓ 0202: actor-identity visible to guests/strangers only for guest-visible posts; OnlyMe hidden; owner sees own'; end $$;

rollback;

\echo '✓ 0202 post_actor_identity guest-visible regression test passed'
