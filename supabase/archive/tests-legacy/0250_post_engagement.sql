-- KC#867 / KC#878 — post engagement schema, counters, RPCs, RLS.

create or replace function pg_temp.assert(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERT FAILED: %', p_msg; end if;
end $$;
-- Called below under `set local role`: new functions are owner-only by default (0520).
grant execute on function pg_temp.assert(boolean, text) to public;

create or replace function pg_temp.mk_user(p_handle text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, email, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data,
    aud, role
  ) values (
    v_id, p_handle || '@test.local', now(),
    jsonb_build_object('full_name', 'Display ' || p_handle),
    jsonb_build_object('provider', 'email'),
    'authenticated', 'authenticated'
  );
  update public.users
     set share_handle = p_handle, display_name = 'Display ' || p_handle, account_status = 'active'
   where user_id = v_id;
  return v_id;
end $$;

-- ─── counters + reaction RPC ───────────────────────────────────────────────────
do $$
declare
  v_owner uuid := pg_temp.mk_user('eng_owner_' || substr(gen_random_uuid()::text, 1, 6));
  v_viewer uuid := pg_temp.mk_user('eng_view_' || substr(gen_random_uuid()::text, 1, 6));
  v_post uuid;
  v_stats public.post_stats;
begin
  insert into public.posts (
    owner_id, type, title, status, visibility,
    city, street, street_number, location_display_level, category
  ) values (
    v_owner, 'Give', 'engagement post', 'open', 'Public',
    'tel-aviv', 'Test', '1', 'CityOnly', 'Other'
  ) returning post_id into v_post;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_viewer::text)::text, true);
  set local role authenticated;

  perform public.rpc_set_post_reaction(v_post, 'like');

  select * into v_stats from public.post_stats where post_id = v_post;
  perform pg_temp.assert(v_stats.reaction_count = 1, 'reaction_count should be 1');

  perform public.rpc_create_post_comment(v_post, 'hello world', null);

  select * into v_stats from public.post_stats where post_id = v_post;
  perform pg_temp.assert(v_stats.comment_count = 1, 'comment_count should be 1');

  reset role;
  raise notice '✓ post engagement counters updated via triggers';
end $$;

-- ─── OnlyMe post hidden from non-owner ───────────────────────────────────────
do $$
declare
  v_owner uuid := pg_temp.mk_user('eng_priv_o_' || substr(gen_random_uuid()::text, 1, 6));
  v_other uuid := pg_temp.mk_user('eng_priv_x_' || substr(gen_random_uuid()::text, 1, 6));
  v_post uuid;
  v_cnt int;
begin
  insert into public.posts (
    owner_id, type, title, status, visibility,
    city, street, street_number, location_display_level, category
  ) values (
    v_owner, 'Give', 'private post', 'open', 'OnlyMe',
    'tel-aviv', 'Test', '2', 'CityOnly', 'Other'
  ) returning post_id into v_post;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_other::text)::text, true);
  set local role authenticated;

  select count(*) into v_cnt from public.post_reactions where post_id = v_post;
  perform pg_temp.assert(v_cnt = 0, 'non-owner should not see reactions on OnlyMe post');

  begin
    perform public.rpc_set_post_reaction(v_post, 'like');
    raise exception 'ASSERT FAILED: reaction on OnlyMe post should fail RLS';
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm not like '%row-level security%' and sqlerrm not like '%violates%policy%' then
        raise;
      end if;
  end;

  reset role;
  raise notice '✓ OnlyMe engagement blocked for non-owner';
end $$;

\echo '✓ 0250_post_engagement.sql passed'
