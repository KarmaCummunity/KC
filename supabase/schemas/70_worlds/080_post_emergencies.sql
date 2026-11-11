-- Worlds · post_emergencies (the emergency button of a ride or a stay)
--
-- A member taking part in an active ride (spec 5.3 step 6) or stay (FR-HOUSING-024) calls
-- for help. The call is recorded, everyone else taking part is notified at once, and the
-- safety team is told through a `moderation` event. KC is not an emergency service: the
-- app shows the emergency numbers first; this is the record and the alert.

create table public.post_emergencies (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts (id) on delete cascade,
  reporter_id uuid not null references public.users (id) on delete cascade,
  note        text check (char_length(note) <= 500),
  -- Where the caller was, when they chose to share it.
  location    extensions.geography(Point, 4326),
  created_at  timestamptz not null default now()
);
comment on table public.post_emergencies is
  'Emergency calls made from an active ride or stay. Written only by server code.';

-- Calls of a post, newest first; covers the post foreign key.
create index post_emergencies_post_recent_idx on public.post_emergencies (post_id, created_at desc);
-- Throttle of a caller, and the reporter foreign key.
create index post_emergencies_reporter_recent_idx on public.post_emergencies (reporter_id, created_at desc);

alter table public.post_emergencies enable row level security;
alter table public.post_emergencies force row level security;

-- The caller and the owner of the post see that a call was made. Extension point: the
-- moderation module adds the policy that lets the safety team read every call.
create policy post_emergencies_select_party on public.post_emergencies
  for select to authenticated
  using (reporter_id = (select auth.uid())
         or exists (select 1 from public.posts p
                     where p.id = post_emergencies.post_id and p.owner_id = (select auth.uid())));

-- Existence only: the note and the location are for the safety team (FR-HOUSING-024 AC3).
grant select (id, post_id, reporter_id, created_at) on public.post_emergencies to authenticated;

-- Members taking part in a post right now, for the emergency call:
--   ride   the driver and every passenger with an approved or completed booking, from one
--          hour before departure until two hours after the estimated end (six hours after
--          departure when no end was stated)
--   stay   the host and every guest whose approved or completed booking is under way,
--          from one hour before its start until two hours after its end
create function kc_private.post_active_participants(p_post_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.owner_id
    from public.posts p
    join public.post_ride_details r on r.post_id = p.id
   where p.id = p_post_id
     and now() between r.departs_at - interval '1 hour'
                   and coalesce(r.arrives_at, r.departs_at + interval '6 hours') + interval '2 hours'
  union
  select h.recipient_id
    from public.post_handoffs h
    join public.post_ride_details r on r.post_id = h.post_id
   where h.post_id = p_post_id and h.status in ('confirmed', 'handed_over')
     and now() between r.departs_at - interval '1 hour'
                   and coalesce(r.arrives_at, r.departs_at + interval '6 hours') + interval '2 hours'
  union
  select unnest(array[h.owner_id, h.recipient_id])
    from public.post_handoffs h
   where h.post_id = p_post_id and h.machine_id = 'housing_booking'
     and h.status in ('confirmed', 'handed_over')
     and now() between h.slot_starts_at - interval '1 hour' and h.slot_ends_at + interval '2 hours';
$$;
comment on function kc_private.post_active_participants(uuid) is
  'Members of a ride or stay that is under way: who may call for help and who is alerted.';

-- Records an emergency call and alerts the other participants and the safety team.
--   emergency_not_active  the caller takes no part in the post, or it is not under way
--                         (one answer for both, so a post is not probed)
--   emergency_throttled   the caller already called on this post in the last five minutes
create function public.report_post_emergency(
  p_post_id uuid, p_note text default null,
  p_lat double precision default null, p_lng double precision default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
  v_participants constant uuid[] := array(select kc_private.post_active_participants(p_post_id));
  v_emergency_id uuid;
  v_to uuid;
begin
  if not v_user_id = any (v_participants) then
    raise exception 'emergency_not_active' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.post_emergencies e
              where e.post_id = p_post_id and e.reporter_id = v_user_id
                and e.created_at > now() - interval '5 minutes') then
    raise exception 'emergency_throttled' using errcode = 'P0001';
  end if;

  insert into public.post_emergencies (post_id, reporter_id, note, location)
  values (p_post_id, v_user_id, nullif(btrim(p_note), ''),
          extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography)
  returning id into v_emergency_id;

  foreach v_to in array v_participants loop
    continue when v_to = v_user_id;
    perform kc_private.outbox_enqueue('notification', jsonb_build_object(
      'kind', 'post_emergency', 'recipient_id', v_to, 'actor_id', v_user_id,
      'entity', jsonb_build_object('type', 'post', 'id', p_post_id),
      'data', jsonb_build_object(
        'emergency_id', v_emergency_id,
        'dedupe_key', 'post_emergency:' || v_emergency_id || ':' || v_to)));
  end loop;
  -- The safety team (support, super admins) is alerted by the moderation module.
  perform kc_private.outbox_enqueue('moderation', jsonb_build_object(
    'kind', 'post_emergency', 'emergency_id', v_emergency_id, 'post_id', p_post_id,
    'reporter_id', v_user_id));
  return v_emergency_id;
end;
$$;
comment on function public.report_post_emergency(uuid, text, double precision, double precision) is
  'The caller, taking part in an active ride or stay, calls for help; the other participants and the safety team are alerted.';
grant execute on function public.report_post_emergency(uuid, text, double precision, double precision)
  to authenticated;
