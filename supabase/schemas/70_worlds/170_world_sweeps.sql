-- Worlds · sweeps (run by the scheduler as the service role; scheduled by the ops module)
--
-- Time-driven moves of the worlds, all in the machine role `system`. Rows are claimed with
-- SKIP LOCKED and re-checked by the machines, so each sweep is safe to run concurrently
-- with itself and with member actions. What each world needs, and where it lives:
--   ride / event / food / stay-offer / lesson expiry   kc_private.post_expiry_sweep (here):
--       every detail table writes its own `posts.expires_at`, so one sweep serves them all
--   unanswered ride, stay, event and lesson bookings   kc_private.handoff_reservation_expiry_sweep
--       (25_handoffs/080), on `confirm_by`
--   recurring rides                                    kc_private.ride_series_materialize (070)
--   stays nobody closed                                kc_private.housing_not_completed_sweep (here)
--   food about to expire                               kc_private.food_expiry_alert_sweep (here)

-- Expires open and paused posts whose time has come (D21, D128), in every world. Before
-- the post leaves the air its bookings are ended with an honest reason: a request nobody
-- answered `expired`, an approved booking nobody completed `not_completed` — never
-- completed automatically, so no karma is earned without a member saying so. Registrations
-- of an event that took place stay for attendance marking (25_handoffs/050). The owner is
-- told. Before, the ride sweep left bookings live and each world had its own writer.
create function kc_private.post_expiry_sweep(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post record;
  v_handoff record;
  v_count integer := 0;
begin
  for v_post in
    select p.id, p.owner_id, p.world_slug from public.posts p
     where p.expires_at <= now() and p.status in ('open', 'paused')
     order by p.expires_at
     limit least(greatest(p_limit, 1), 5000)
       for update skip locked
  loop
    for v_handoff in
      select h.id, h.status from public.post_handoffs h
       where h.post_id = v_post.id and h.status in ('reserved', 'confirmed')
         and h.machine_id <> 'event_registration'
    loop
      perform kc_private.handoff_move(
        v_handoff.id, 'cancelled', 'system',
        case v_handoff.status when 'reserved' then 'expired' else 'not_completed' end);
    end loop;
    perform kc_private.post_move(v_post.id, 'expired', 'system');
    perform kc_private.outbox_enqueue('notification', jsonb_build_object(
      'kind', 'post_expired', 'recipient_id', v_post.owner_id, 'actor_id', null,
      'entity', jsonb_build_object('type', 'post', 'id', v_post.id),
      'data', jsonb_build_object('world_slug', v_post.world_slug, 'dedupe_key', 'post_expired:' || v_post.id)));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
comment on function kc_private.post_expiry_sweep(integer) is
  'Expires due posts of every world, ending their open bookings first; returns how many.';

-- Housing sweep: approved stays whose end passed more than seven days ago.
create index post_handoffs_stay_close_due_idx on public.post_handoffs (slot_ends_at)
  where status = 'confirmed' and machine_id = 'housing_booking';

-- An approved stay that nobody closed within seven days of its end is cancelled as
-- `not_completed`: nothing completes by itself and no karma follows (FR-HOUSING-019 AC5).
create function kc_private.housing_not_completed_sweep(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handoff_id uuid;
  v_count integer := 0;
begin
  for v_handoff_id in
    select h.id from public.post_handoffs h
     where h.status = 'confirmed' and h.machine_id = 'housing_booking'
       and h.slot_ends_at < now() - interval '7 days'
     order by h.slot_ends_at
     limit least(greatest(p_limit, 1), 5000)
       for update skip locked
  loop
    perform kc_private.handoff_move(v_handoff_id, 'cancelled', 'system', 'not_completed');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
comment on function kc_private.housing_not_completed_sweep(integer) is
  'Cancels approved stays left unclosed seven days after their end; returns how many.';

-- Food offers nearing their expiry: the urgency of an open offer rises to high inside 72
-- hours, and inside 24 hours its owner is told once that it is about to close (S4,
-- FR-NOTIF-005). Returns the number of owners told.
create function kc_private.food_expiry_alert_sweep(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_food record;
  v_count integer := 0;
begin
  update public.posts p
     set urgency_level = 3
    from public.post_food_details f
   where f.post_id = p.id and f.expires_at <= now() + interval '72 hours'
     and p.status = 'open' and p.urgency_level is distinct from 3;

  for v_food in
    select f.post_id, f.expires_at, p.owner_id
      from public.post_food_details f
      join public.posts p on p.id = f.post_id
     where f.expires_at > now() and f.expires_at <= now() + interval '24 hours'
       and f.expiry_alerted_at is null and p.status = 'open'
     order by f.expires_at
     limit least(greatest(p_limit, 1), 5000)
       for update of f skip locked
  loop
    update public.post_food_details f set expiry_alerted_at = now() where f.post_id = v_food.post_id;
    perform kc_private.outbox_enqueue('notification', jsonb_build_object(
      'kind', 'post_expiring', 'recipient_id', v_food.owner_id, 'actor_id', null,
      'entity', jsonb_build_object('type', 'post', 'id', v_food.post_id),
      'data', jsonb_build_object(
        'world_slug', 'food', 'expires_at', v_food.expires_at,
        'dedupe_key', 'post_expiring:' || v_food.post_id || ':' || v_food.expires_at)));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
comment on function kc_private.food_expiry_alert_sweep(integer) is
  'Raises the urgency of food offers inside 72 hours of expiry and alerts owners inside 24 hours.';
