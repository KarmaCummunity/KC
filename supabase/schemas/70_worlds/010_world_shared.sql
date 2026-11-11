-- Worlds · shared building blocks of the per-world flows
--
-- The worlds whose fields are filtered, constrained or scheduled get a 1:1 detail table on
-- top of `posts` and their own RPCs on top of `post_handoffs` (design §3.2):
--   transport (rides)  post_ride_details      housing  post_housing_details
--   time (events)      post_event_details     food     post_food_details
--   knowledge          post_knowledge_slots (bookable times only)
-- Items, animals, medical, money, democracy, employment and challenges keep their fields in
-- `posts.details` and use the generic handoff flow. Of this file only
-- public.accept_world_consent is callable from a device.

-- A recurring ride is published by the scheduler, not by its owner's request (D103).
insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  ('post', 'draft', 'open', 'system');

-- Position of an official place (D71): a road junction, a street of a city (its centroid,
-- or the city centre until the street is geocoded) or a city. Exactly one shape is
-- accepted — junction alone, city alone, or city with street; null for anything else and
-- for a place that is not in the catalogs or has no position.
-- Reads only the public reference lists, with the caller's rights.
create function kc_access.place_point(p_city_id text, p_street_id integer, p_junction_id integer)
returns extensions.geography
language sql
stable
set search_path = ''
as $$
  select case
    when p_junction_id is not null and p_city_id is null and p_street_id is null then
      (select j.location from public.road_junctions j where j.junction_id = p_junction_id)
    when p_junction_id is null and p_street_id is not null then
      (select coalesce(s.location, c.location)
         from public.streets s join public.cities c on c.city_id = s.city_id
        where s.city_id = p_city_id and s.street_id = p_street_id)
    when p_junction_id is null then
      (select c.location from public.cities c where c.city_id = p_city_id)
  end;
$$;
comment on function kc_access.place_point(text, integer, integer) is
  'Position of an official place (city, city + street, or road junction); null when the place is unknown.';
grant execute on function kc_access.place_point(text, integer, integer) to authenticated;

-- Version of a world consent that is in force. The texts live in the app's legal bundle;
-- a new version is a one-line change here and asks every member again.
create function kc_private.world_consent_version(p_kind text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_kind when 'driver_declaration' then 1 when 'housing_conduct' then 1 end;
$$;
comment on function kc_private.world_consent_version(text) is
  'Current version of the driver declaration (FR-RIDE-041) and of the housing code of conduct (S59).';

create function kc_private.world_consent_accepted(p_user_id uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.user_consents c
                  where c.user_id = p_user_id and c.consent_kind = p_kind
                    and c.version = kc_private.world_consent_version(p_kind));
$$;
comment on function kc_private.world_consent_accepted(uuid, text) is
  'The member accepted the current version of a world consent.';

-- >>> M11: the consents in force, for `bootstrap_session`. One entry per consent kind,
-- `{ "<kind>": { "version": <int>, "accepted": <bool> } }`: the app shows the driver
-- declaration or the code of conduct when `accepted` is false and sends `version` to
-- accept_world_consent. `accepted` is the caller's own state.
create function kc_access.world_consents()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_object_agg(k.kind, jsonb_build_object(
           'version', kc_private.world_consent_version(k.kind),
           'accepted', kc_private.world_consent_accepted((select auth.uid()), k.kind)))
    from (values ('driver_declaration'), ('housing_conduct')) k (kind);
$$;
comment on function kc_access.world_consents() is
  'Current version of each world consent and whether the caller accepted it; used by bootstrap_session.';
grant execute on function kc_access.world_consents() to authenticated;
-- <<< M11

-- The caller accepts the driver declaration or the housing code of conduct. Only the
-- version in force is accepted, so an old screen cannot record a stale consent.
create function public.accept_world_consent(
  p_kind text, p_version integer, p_locale text default null, p_user_agent text default null)
returns public.user_consents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
begin
  if kc_private.world_consent_version(p_kind) is null then
    raise exception 'unknown_consent_kind' using errcode = 'P0001';
  end if;
  if p_version is distinct from kc_private.world_consent_version(p_kind) then
    raise exception 'consent_version_stale' using errcode = 'P0001';
  end if;
  return kc_private.record_consent(v_user_id, p_kind, p_version, p_locale, p_user_agent);
end;
$$;
comment on function public.accept_world_consent(text, integer, text, text) is
  'Records the caller''s consent to the current driver declaration or housing code of conduct.';
grant execute on function public.accept_world_consent(text, integer, text, text) to authenticated;

-- Raises unless the member may act in a world that requires a verified identity (D30,
-- D116): an identity document or better (users.verification_level 2+).
create function kc_private.world_assert_verified(p_user_id uuid, p_world_slug text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select w.requires_verification from public.worlds w where w.slug = p_world_slug)
     and not exists (select 1 from public.users u where u.id = p_user_id and u.verification_level >= 2) then
    raise exception 'verification_required' using errcode = 'P0001';
  end if;
end;
$$;
comment on function kc_private.world_assert_verified(uuid, text) is
  'Raises verification_required when the world asks for a verified identity the member lacks.';

-- The post a detail row is being written for, when it is of the expected post type; raises
-- post_details_mismatch otherwise. Called by the BEFORE trigger of every detail table.
create function kc_private.post_for_details(p_post_id uuid, p_post_type text)
returns public.posts
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_post public.posts;
begin
  select p.* into v_post from public.posts p where p.id = p_post_id;
  if not found or v_post.post_type <> p_post_type then
    raise exception 'post_details_mismatch' using errcode = 'P0001',
      detail = format('the post is not of type %s', p_post_type);
  end if;
  return v_post;
end;
$$;
comment on function kc_private.post_for_details(uuid, text) is
  'Returns the post of a detail row; raises post_details_mismatch unless it has the expected post type.';

-- May this member book the post, as far as seeing it goes? Asked before any world rule
-- is checked, so that a refusal (departed, started, full) never tells a member about a
-- post they cannot see. The owner passes here and is refused as own_listing by
-- kc_private.handoff_open.
create function kc_private.post_bookable_by(p_post public.posts, p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_post.owner_id = p_member_id or kc_private.post_open_to_member(p_post, p_member_id);
$$;
comment on function kc_private.post_bookable_by(public.posts, uuid) is
  'The member owns the post or could open it; the first check of every world booking RPC.';

-- Locks a booking of the given machine for a move by the caller and returns it. One error
-- for "no such booking", "another world's booking" and "not yours", so nothing is revealed.
--   p_owner_only  the move belongs to the post owner (approve, complete, mark)
--   p_active      the caller needs an active account; a cancellation does not
create function kc_private.world_handoff_lock(
  p_handoff_id uuid, p_machine text, p_owner_only boolean default false, p_active boolean default true)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := case when p_active then kc_private.require_active_caller()
                                  else kc_private.require_caller() end;
  v_handoff constant public.post_handoffs := kc_private.handoff_lock(p_handoff_id);
begin
  if v_handoff.machine_id <> p_machine
     or v_user_id not in (v_handoff.owner_id, v_handoff.recipient_id)
     or (p_owner_only and v_user_id <> v_handoff.owner_id) then
    raise exception 'handoff_not_found' using errcode = 'P0001';
  end if;
  return v_handoff;
end;
$$;
comment on function kc_private.world_handoff_lock(uuid, text, boolean, boolean) is
  'Row-locks a booking of one machine for a move by one of its members (or its owner only).';
