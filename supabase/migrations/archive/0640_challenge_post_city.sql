-- 0640_challenge_post_city | docs/spec/10_challenges.md
-- 0639 stored the challenge post's city as the slug 'tel-aviv'. cities.city_id for
-- Tel Aviv is '5000', so every open failed the posts_city_fkey and the app showed
-- a generic error. Use the creator's real city, otherwise Tel Aviv's id.

begin;

create or replace function public.create_challenge(
  p_title text,
  p_scope text,
  p_measurement text,
  p_cadence text,
  p_description text default null,
  p_goal_value numeric default null,
  p_goal_direction text default null,
  p_difficulty text default null,
  p_topic_label text default null,
  p_ends_at timestamptz default null,
  p_target_cycles int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := gen_random_uuid();
  v_post uuid;
  v_city text;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  if p_ends_at is not null and p_ends_at <= now() then
    raise exception 'ends_at_invalid' using errcode = '22023';
  end if;
  perform public.enforce_rate_limit('challenge_create:' || v_uid::text, 10, 3600);

  insert into public.challenges (
    challenge_id, creator_id, title, description, scope, measurement, cadence, goal_value,
    goal_direction, difficulty, topic_label, ends_at, target_cycles
  ) values (
    v_id, v_uid, btrim(p_title), nullif(btrim(p_description), ''), p_scope, p_measurement, p_cadence,
    p_goal_value, p_goal_direction, p_difficulty, nullif(btrim(p_topic_label), ''), p_ends_at,
    p_target_cycles
  );

  insert into public.challenge_participations (challenge_id, user_id) values (v_id, v_uid);

  -- posts.city is a cities.city_id (Tel Aviv is 5000), not a slug.
  v_city := coalesce(
    (select u.city from public.users u
      where u.user_id = v_uid
        and exists (select 1 from public.cities c where c.city_id = u.city)),
    (select c.city_id from public.cities c where c.name_he like 'תל אביב%' order by c.city_id limit 1),
    (select c.city_id from public.cities c order by c.city_id limit 1)
  );
  if v_city is null then
    raise exception 'city_required' using errcode = '23503';
  end if;
  insert into public.posts (
    owner_id, type, status, visibility, title, description, category,
    city, street, street_number, location_display_level,
    world_slug, listing_world_slug, post_type, details
  ) values (
    v_uid, 'Give', 'open',
    case when p_scope = 'personal' then 'OnlyMe' else 'Public' end,
    left(btrim(p_title), 80),
    left(nullif(btrim(p_description), ''), 500),
    'Other',
    v_city, 'Marketplace', '1', 'CityOnly',
    'challenges', 'challenges', 'challenge',
    jsonb_strip_nulls(jsonb_build_object(
      'challenge_id', v_id,
      'scope', p_scope,
      'measurement', p_measurement,
      'cadence', p_cadence,
      'goal_value', p_goal_value,
      'goal_direction', p_goal_direction,
      'difficulty', p_difficulty,
      'topic_label', nullif(btrim(p_topic_label), '')
    ))
  ) returning post_id into v_post;

  update public.challenges set post_id = v_post where challenge_id = v_id;

  if (
    select count(*) from public.karma_ledger
     where user_id = v_uid and event_type = 'challenge_opened'
       and (created_at at time zone 'Asia/Jerusalem')::date = public.challenge_today()
  ) < 2 then
    perform public.challenge_grant_karma_once(
      v_uid, 'challenge_opened', 'challenge', v_id::text,
      public.challenge_karma_points('challenge_opened', p_scope, 1));
  end if;

  return v_id;
end;
$$;


commit;
