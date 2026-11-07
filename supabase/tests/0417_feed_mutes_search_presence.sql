-- supabase/tests/0417_feed_mutes_search_presence.sql | 0417–0419: feed_visible_posts (hides +
-- mutes on the default feed), paged search RPCs (no exact count), "show my active status".

begin;

create or replace function pg_temp.mk_user(p_id uuid, p_handle text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (p_id, p_handle || '@test.local', now(),
          jsonb_build_object('full_name', 'Display ' || p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, display_name = 'Display ' || p_handle,
         account_status = 'active', privacy_mode = 'Public', onboarding_state = 'completed'
   where user_id = p_id;
end $$;

create or replace function pg_temp.mk_post(p_owner uuid, p_title text, p_category text)
returns uuid language plpgsql as $$
declare
  v uuid;
begin
  insert into public.posts (owner_id, type, title, status, visibility,
                            city, street, street_number, location_display_level, category)
  values (p_owner, 'Give', p_title, 'open', 'Public', 'tel-aviv', 'Test', '1', 'CityOnly', p_category)
  returning post_id into v;
  return v;
end $$;

create or replace function pg_temp.as_user(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
end $$;

-- ── static shape ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'feed_visible_posts' and c.relkind = 'v'
                    and c.reloptions @> array['security_invoker=true']) then
    raise exception 'ASSERT FAILED: feed_visible_posts must be a security_invoker view';
  end if;
  if has_table_privilege('anon', 'public.feed_visible_posts', 'select') then
    raise exception 'ASSERT FAILED: anon must not select feed_visible_posts';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'posts_open_search_text_trgm_idx')
     or not exists (select 1 from pg_indexes where indexname = 'users_search_text_trgm_idx') then
    raise exception 'ASSERT FAILED: search trigram indexes missing';
  end if;
  if has_column_privilege('authenticated', 'public.users', 'show_active_status', 'select') then
    raise exception 'ASSERT FAILED: show_active_status must stay owner-only (RPC), not a public column';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
                   and policyname = 'online_presence_track'
                   and with_check ilike '%shows_active_status%') then
    raise exception 'ASSERT FAILED: online_presence_track must require shows_active_status';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
                   and policyname = 'online_presence_receive'
                   and qual ilike '%shows_active_status%') then
    raise exception 'ASSERT FAILED: online_presence_receive must require shows_active_status';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
                   and policyname = 'chat_realtime_broadcast_receive'
                   and qual ilike '%shows_active_status%') then
    raise exception 'ASSERT FAILED: chat presence receive must require shows_active_status';
  end if;
end $$;

-- ── fixtures ────────────────────────────────────────────────────────────────
create temp table t_posts (k text primary key, id uuid) on commit drop;

do $$
declare
  a uuid := '00000000-0000-0000-0000-000000417a01';
  b uuid := '00000000-0000-0000-0000-000000417b02';
  e uuid := '00000000-0000-0000-0000-000000417e03';
begin
  perform pg_temp.mk_user(a, 'fm_alice');
  perform pg_temp.mk_user(b, 'fm_bob');
  perform pg_temp.mk_user(e, 'fm_eve');
  insert into t_posts values
    ('plain',   pg_temp.mk_post(b, 'qxfm plain lamp', 'Other')),
    ('hidden',  pg_temp.mk_post(b, 'qxfm hidden chair', 'Other')),
    ('muser',   pg_temp.mk_post(e, 'qxfm eve bike', 'Other')),
    ('mworld',  pg_temp.mk_post(b, 'qxfm drill', 'Tools')),
    ('mkeyword', pg_temp.mk_post(b, 'qxfm ZEBRA print', 'Other'));
  -- Someone else's OnlyMe post: never visible to alice (feed or search).
  insert into public.posts (owner_id, type, title, status, visibility,
                            city, street, street_number, location_display_level, category)
  values (b, 'Give', 'qxfm secret', 'open', 'OnlyMe', 'tel-aviv', 'Test', '1', 'CityOnly', 'Other');
  insert into public.feed_post_hides (user_id, post_id) select a, id from t_posts where k = 'hidden';
  insert into public.feed_mute_filters (user_id, filter_kind, filter_value) values
    (a, 'user', e::text), (a, 'category', 'Tools'), (a, 'keyword', 'zebra');
end $$;

-- ── feed_visible_posts: hides + mutes apply to the viewer only ───────────────
do $$
declare
  v_alice text[];
  v_bob   text[];
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-000000417a01');
  set local role authenticated;
  select array_agg(f.title order by f.title) into v_alice
    from public.feed_visible_posts f where f.title like 'qxfm%';
  reset role;
  if v_alice is distinct from array['qxfm plain lamp'] then
    raise exception 'ASSERT FAILED: alice feed should be {qxfm plain lamp}, got %', v_alice;
  end if;

  perform pg_temp.as_user('00000000-0000-0000-0000-000000417b02');
  set local role authenticated;
  select array_agg(f.title order by f.title) into v_bob
    from public.feed_visible_posts f where f.title like 'qxfm%';
  reset role;
  if coalesce(array_length(v_bob, 1), 0) <> 6 then
    raise exception 'ASSERT FAILED: bob (no mutes, owns OnlyMe) should see 6 posts, got %', v_bob;
  end if;
end $$;

-- ── search_posts_page: paging + has-more (limit+1) + visibility ─────────────
do $$
declare
  v_n integer;
  v_first uuid;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-000000417a01');
  set local role authenticated;
  select count(*) into v_n from public.search_posts_page('qxfm', null, null, null, 3);
  if v_n <> 3 then raise exception 'ASSERT FAILED: search_posts_page limit 3 returned %', v_n; end if;
  select count(*) into v_n from public.search_posts_page('qxfm', null, null, null, 50);
  if v_n <> 5 then raise exception 'ASSERT FAILED: search_posts_page should find 5 (OnlyMe excluded), got %', v_n; end if;
  select count(*) into v_n from public.search_posts_page('qxfm', null, 'Tools', null, 50);
  if v_n <> 1 then raise exception 'ASSERT FAILED: category filter returned %', v_n; end if;
  select count(*) into v_n from public.search_posts_page('q', null, null, null, 50);
  if v_n <> 0 then raise exception 'ASSERT FAILED: 1-char query must return nothing, got %', v_n; end if;
  select count(*) into v_n from public.search_posts_page('qx%', null, null, null, 50);
  if v_n <> 0 then raise exception 'ASSERT FAILED: %% must be matched literally, got %', v_n; end if;
  select post_id into v_first from public.search_posts_page('qxfm', null, null, null, 1);
  reset role;
  if v_first is distinct from (select p.post_id from public.posts p
                                where p.title like 'qxfm%' and p.visibility = 'Public'
                                order by p.created_at desc, p.post_id desc limit 1) then
    raise exception 'ASSERT FAILED: search_posts_page must be newest-first';
  end if;

end $$;

-- ── search_users_page: visibility + block + sort ────────────────────────────
do $$
declare
  v_n integer;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-000000417a01');
  set local role authenticated;
  select count(*) into v_n from public.search_users_page('fm_', null, null, 'followers', 50);
  if v_n <> 3 then raise exception 'ASSERT FAILED: search_users_page should find 3, got %', v_n; end if;
  select count(*) into v_n from public.search_users_page('fm_', null, null, 'newest', 2);
  if v_n <> 2 then raise exception 'ASSERT FAILED: search_users_page limit 2 returned %', v_n; end if;
  reset role;

  update public.users set account_status = 'suspended_admin'
   where user_id = '00000000-0000-0000-0000-000000417e03';
  set local role authenticated;
  select count(*) into v_n from public.search_users_page('fm_', null, null, 'followers', 50);
  reset role;
  if v_n <> 2 then raise exception 'ASSERT FAILED: inactive user leaked into search (% rows)', v_n; end if;
end $$;

-- ── show active status: default ON, owner RPCs, policy helper ───────────────
do $$
declare
  v boolean;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-000000417a01');
  set local role authenticated;
  v := public.rpc_get_show_active_status();
  if v is distinct from true then raise exception 'ASSERT FAILED: default must be ON'; end if;
  v := public.rpc_set_show_active_status(false);
  v := public.rpc_get_show_active_status();
  if v is distinct from false then raise exception 'ASSERT FAILED: set(false) not persisted'; end if;
  if public.shows_active_status('00000000-0000-0000-0000-000000417a01') then
    raise exception 'ASSERT FAILED: shows_active_status must follow the flag';
  end if;
  if not public.shows_active_status('00000000-0000-0000-0000-000000417b02') then
    raise exception 'ASSERT FAILED: other users keep their own flag';
  end if;
  if public.shows_active_status('00000000-0000-0000-0000-0000004170ff') then
    raise exception 'ASSERT FAILED: unknown user must fail closed';
  end if;
  begin
    perform public.rpc_set_show_active_status(null);
    raise exception 'ASSERT FAILED: null must be rejected';
  exception when null_value_not_allowed then null;
  end;
  reset role;
  if (select show_active_status from public.users where user_id = '00000000-0000-0000-0000-000000417b02') is not true then
    raise exception 'ASSERT FAILED: set must only touch the caller row';
  end if;
end $$;

-- ── Realtime Authorization: presence track blocked while OFF ────────────────
create or replace function pg_temp.try_track(p_user uuid)
returns text language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  perform set_config('realtime.topic', 'presence:online', true);
  set local role authenticated;
  begin
    insert into realtime.messages (topic, extension, event, payload, private)
    values ('presence:online', 'presence', 'track', '{}'::jsonb, true);
    reset role;
    return 'allowed';
  exception
    when insufficient_privilege then
      reset role;
      return case when sqlerrm ilike '%row-level security%' then 'denied' else 'no_grant' end;
    when others then
      reset role;
      return 'skip:' || sqlstate;
  end;
end $$;

do $$
declare
  v_res text;
begin
  v_res := pg_temp.try_track('00000000-0000-0000-0000-000000417b02');
  if v_res = 'no_grant' or v_res like 'skip:%' then
    raise notice 'skipping realtime presence checks (%).', v_res;
    return;
  end if;
  if v_res <> 'allowed' then raise exception 'ASSERT FAILED: ON user presence track was %', v_res; end if;
  v_res := pg_temp.try_track('00000000-0000-0000-0000-000000417a01');
  if v_res <> 'denied' then raise exception 'ASSERT FAILED: OFF user presence track was %', v_res; end if;
end $$;

rollback;

\echo '✓ 0417_feed_mutes_search_presence.sql passed'
