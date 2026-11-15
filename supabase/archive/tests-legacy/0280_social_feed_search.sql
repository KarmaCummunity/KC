-- KC#870/#871/#872 — feed filters, search_all, follow suggestions smoke.

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
     set share_handle = p_handle,
         display_name = 'Display ' || p_handle,
         account_status = 'active',
         onboarding_state = 'completed',
         biography = 'Bio long enough for completeness score',
         city = 'tel-aviv'
   where user_id = v_id;
  return v_id;
end $$;

do $$
declare
  v_a uuid := pg_temp.mk_user('soc_a_' || substr(gen_random_uuid()::text, 1, 6));
  v_b uuid := pg_temp.mk_user('soc_b_' || substr(gen_random_uuid()::text, 1, 6));
  v_post uuid;
  v_json jsonb;
  v_cnt int;
begin
  insert into public.posts (
    owner_id, type, title, status, visibility,
    city, street, street_number, location_display_level, category
  ) values (
    v_a, 'Give', 'searchable widget', 'open', 'Public',
    'tel-aviv', 'Test', '1', 'CityOnly', 'Other'
  ) returning post_id into v_post;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_b::text)::text, true);
  set local role authenticated;

  perform public.rpc_feed_hide_post(v_post);
  v_cnt := (select count(*) from public.feed_ranked_ids(
    v_b, null, null, null, 'open', null, null,
    'newest', null, 50, null, null, null, null, false, null
  ) r where r.post_id = v_post);
  if v_cnt <> 0 then
    raise exception 'expected hidden post absent from feed, got %', v_cnt;
  end if;

  v_json := public.search_all('widget', array['posts'], 5);
  if coalesce(jsonb_array_length(v_json -> 'posts'), 0) < 1 then
    raise exception 'search_all expected at least one post';
  end if;

  v_json := public.rpc_profile_completeness(v_b);
  if (v_json ->> 'score')::int < 50 then
    raise exception 'profile completeness score too low: %', v_json;
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_a::text)::text, true);
  if not exists (select 1 from public.rpc_follow_suggestions(5) s where s.user_id = v_b) then
    raise exception 'expected follow suggestion for peer user';
  end if;
end $$;
