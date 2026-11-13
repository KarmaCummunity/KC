-- 0639_challenge_posts | docs/spec/10_challenges.md, FR-FEED-020, FR-POST-001 AC6
-- Opening a challenge writes a post of post_type 'challenge' in the challenges world, the same
-- way every other giving world publishes into the feed. The world screen is that feed.
-- A community challenge is a public post; a personal one is OnlyMe. Ending the challenge
-- pauses the post so it leaves the open feed. Karma stays the challenge schedule (07 §7.6):
-- the generic post-created award only fires for items posts (0554).

begin;

-- ── 1. The challenges world, so a post can belong to it ──────────────────────
do $$
declare
  r record;
begin
  for r in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public' and rel.relname = 'worlds' and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%prd_index%'
  loop
    execute format('alter table public.worlds drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.worlds add constraint worlds_prd_index_check
  check (prd_index between 1 and 99);

insert into public.worlds (
  slug, prd_index, label_he, label_en, sensitivity, requires_verification,
  default_anonymity_level, default_ttl_hours, geo_mode,
  default_radius_km, geo_weight, geo_decay, sort_order
) values (
  'challenges', 14, 'אתגרים', 'Challenges', 'standard', false,
  3, null, 'remote', 500.00, 0.100, 0.0000, 14
) on conflict (slug) do nothing;

-- ── 2. A challenge post has no listing, but the feed files worlds by listing_world_slug ──
do $$
declare
  r record;
begin
  for r in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public' and rel.relname = 'posts' and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%post_type%'
       and pg_get_constraintdef(con.oid) not ilike '%world_slug%'
  loop
    execute format('alter table public.posts drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.posts add constraint posts_post_type_check
  check (post_type in ('standard', 'ride', 'event', 'housing_stay', 'job', 'challenge'));

alter table public.posts drop constraint if exists posts_listing_world_slug_chk;
alter table public.posts add constraint posts_listing_world_slug_chk
  check (
    ((listing_id is null) = (listing_world_slug is null))
    or (post_type = 'challenge' and listing_id is null and listing_world_slug = 'challenges')
  );

alter table public.challenges
  add column if not exists post_id uuid unique references public.posts(post_id) on delete set null;

-- ── 3. Opening writes the post; ending pauses it ─────────────────────────────
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

create or replace function public.end_challenge(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post uuid;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  update public.challenges set status = 'ended'
   where challenge_id = p_challenge_id and creator_id = v_uid
   returning post_id into v_post;
  if not found then raise exception 'not_challenge_creator' using errcode = '42501'; end if;
  if v_post is not null then
    update public.posts set status = 'paused'
     where post_id = v_post and status = 'open';
  end if;
end;
$$;

-- ── 4. Challenges opened before this migration get their post ────────────────
do $$
declare
  r record;
  v_post uuid;
  v_city text;
begin
  for r in select * from public.challenges where post_id is null loop
    v_city := coalesce(
      (select u.city from public.users u
        where u.user_id = r.creator_id
          and exists (select 1 from public.cities c where c.city_id = u.city)),
      (select c.city_id from public.cities c where c.name_he like 'תל אביב%' order by c.city_id limit 1),
      (select c.city_id from public.cities c order by c.city_id limit 1)
    );
    if v_city is null then
      continue;
    end if;
    insert into public.posts (
      owner_id, type, status, visibility, title, description, category,
      city, street, street_number, location_display_level,
      world_slug, listing_world_slug, post_type, details, created_at
    ) values (
      r.creator_id, 'Give',
      case when r.status = 'active' then 'open' else 'paused' end,
      case when r.scope = 'personal' then 'OnlyMe' else 'Public' end,
      left(btrim(r.title), 80),
      left(nullif(btrim(r.description), ''), 500),
      'Other',
      v_city, 'Marketplace', '1', 'CityOnly',
      'challenges', 'challenges', 'challenge',
      jsonb_build_object('challenge_id', r.challenge_id),
      r.created_at
    ) returning post_id into v_post;
    update public.challenges set post_id = v_post where challenge_id = r.challenge_id;
  end loop;
end $$;

commit;
