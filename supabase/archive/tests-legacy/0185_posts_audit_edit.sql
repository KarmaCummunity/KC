-- TD-109 / FR-POST-008 AC4 — editing a post's content emits a `post_edited`
-- audit_event (actor = editor, fields = changed columns); a no-op update emits
-- nothing.

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

do $$
declare
  v_user uuid := pg_temp.mk_user('edit_' || substr(gen_random_uuid()::text, 1, 8));
  v_post uuid;
  v_cnt  int;
  v_fields_text text;
begin
  insert into public.posts (
    owner_id, type, title, status, visibility,
    city, street, street_number, location_display_level, category
  ) values (
    v_user, 'Give', 'original title', 'open', 'Public',
    'tel-aviv', 'Test', '1', 'CityOnly', 'Other'
  ) returning post_id into v_post;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user::text)::text, true);
  set local role authenticated;

  -- (1) content edit → one post_edited audit row
  update public.posts set title = 'edited title' where post_id = v_post;
  -- (2) no-op update → no new audit row
  update public.posts set title = title where post_id = v_post;

  reset role;

  select count(*) into v_cnt
  from public.audit_events
  where action = 'post_edited' and target_type = 'post'
    and target_id = v_post and actor_id = v_user;
  if v_cnt <> 1 then
    raise exception 'ASSERT FAILED: expected exactly 1 post_edited event, got %', v_cnt;
  end if;

  select metadata ->> 'fields' into v_fields_text
  from public.audit_events
  where action = 'post_edited' and target_type = 'post'
    and target_id = v_post and actor_id = v_user
  limit 1;
  if position('title' in coalesce(v_fields_text, '')) = 0 then
    raise exception 'ASSERT FAILED: post_edited metadata.fields missing "title": %', v_fields_text;
  end if;

  raise notice '✓ post edit emits a post_edited audit_event; no-op emits none (TD-109)';
end $$;
