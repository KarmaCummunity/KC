-- Worlds · recurring knowledge lessons: start, pause / resume / end (FR-KNOW-004 AC1, issue #2035)
--
-- The giver of a lesson offer, or an editor of the post (kc_access.can_edit_post), runs its
-- weekly series. The table, the sweep and the expiry rule are in
-- next-01_knowledge_slot_series.sql; bookings stay public.book_knowledge_seat.

-- Makes a lesson offer recurring and adds its slots for the next 30 days. The offer must
-- not hold upcoming one-off slots (a recurring offer has weekly slots instead, FR-KNOW-003
-- AC2) and never had a series. The first slot proves the schedule: a series that adds none
-- is refused. Returns the series id.
--   knowledge_series_not_allowed        not a lesson offer the caller may edit, or closed
--   knowledge_series_exists             the offer already has (or had) a series
--   knowledge_series_has_slots          the offer holds upcoming one-off slots
--   knowledge_series_schedule_invalid   weekdays outside 1–127, length outside 15 min–8 h,
--                                       capacity outside 1–20, or a last day before today
--   knowledge_series_no_occurrence      no lesson day between today and the last day
create function public.start_knowledge_slot_series(
  p_post_id uuid, p_weekdays integer, p_start_time time, p_duration_minutes integer,
  p_capacity integer default 1, p_ends_on date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_post public.posts;
  v_series_id uuid;
begin
  -- The post row lock serializes a start against a concurrent start or slot write.
  select p.* into v_post from public.posts p where p.id = p_post_id for update;
  if not found
     or not (v_post.owner_id = v_user_id or kc_access.can_edit_post(p_post_id))
     or v_post.status not in ('draft', 'open', 'paused')
     or not exists (select 1 from public.post_kinds k
                     where k.id = v_post.kind_id and k.world_slug = 'knowledge' and k.slug = 'lesson_offer') then
    raise exception 'knowledge_series_not_allowed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.knowledge_slot_series k where k.post_id = p_post_id) then
    raise exception 'knowledge_series_exists' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.post_knowledge_slots s where s.post_id = p_post_id and s.starts_at > now()) then
    raise exception 'knowledge_series_has_slots' using errcode = 'P0001';
  end if;
  begin
    insert into public.knowledge_slot_series (post_id, start_time, duration_minutes, weekdays, capacity, ends_on)
    values (p_post_id, p_start_time, p_duration_minutes, p_weekdays, p_capacity, p_ends_on)
    returning id into v_series_id;
  exception when check_violation or not_null_violation or numeric_value_out_of_range then
    raise exception 'knowledge_series_schedule_invalid' using errcode = 'P0001';
  end;
  perform kc_private.knowledge_offer_sync_expiry(p_post_id);
  if kc_private.knowledge_slot_series_materialize(v_series_id) = 0 then
    raise exception 'knowledge_series_no_occurrence' using errcode = 'P0001';
  end if;
  return v_series_id;
end;
$$;
comment on function public.start_knowledge_slot_series(uuid, integer, time, integer, integer, date) is
  'Makes the caller''s lesson offer recurring and adds its weekly slots for the next 30 days.';
grant execute on function public.start_knowledge_slot_series(uuid, integer, time, integer, integer, date)
  to authenticated;

-- Pauses, resumes or ends the series of a lesson offer (machine `knowledge_slot_series`).
-- Pausing and ending remove the upcoming slots nobody booked and keep the booked ones, so
-- every learner keeps their session (FR-KNOW-004 AC1); resuming adds the next 30 days
-- again. Ending is terminal, and the offer then expires 30 minutes after its last slot.
--   knowledge_series_not_found   no series on this offer, or not one the caller may edit
--   illegal_transition           from an ended series
--   unknown_state                a state the machine does not have
create function public.set_knowledge_slot_series_status(p_post_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_series public.knowledge_slot_series;
begin
  select k.* into v_series
    from public.knowledge_slot_series k
    join public.posts p on p.id = k.post_id
   where k.post_id = p_post_id and (p.owner_id = v_user_id or kc_access.can_edit_post(p.id))
     for update of k;
  if not found then
    raise exception 'knowledge_series_not_found' using errcode = 'P0001';
  end if;
  if p_status = v_series.status then
    return;
  end if;
  update public.knowledge_slot_series k set status = p_status where k.id = v_series.id;
  if p_status = 'active' then
    perform kc_private.knowledge_slot_series_materialize(v_series.id);
  else
    perform kc_private.knowledge_slot_series_drop_unbooked(v_series.id);
  end if;
  perform kc_private.knowledge_offer_sync_expiry(p_post_id);
end;
$$;
comment on function public.set_knowledge_slot_series_status(uuid, text) is
  'Pauses, resumes or ends the weekly series of a lesson offer; booked slots always stay.';
grant execute on function public.set_knowledge_slot_series_status(uuid, text) to authenticated;
