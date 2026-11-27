-- FR-KNOW-004 AC1 (#2478): keep the one-off times submitted with a post in the
-- same transaction as that post. No backfill, new grant, or series-row mutation.
-- Invoker rights deliberately retain the slot table's owner/status/series RLS.
create function kc_private.posts_oneoff_knowledge_slots_sync()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_slots jsonb := new.details -> 'slots';
  v_capacity smallint;
  v_slot record;
  v_previous_end timestamptz;
begin
  if new.world_slug <> 'knowledge' or new.direction <> 'offer'
     or not exists (select 1 from public.post_kinds k where k.id = new.kind_id
                      and k.world_slug = 'knowledge' and k.slug in ('lesson_offer', 'consulting_hour')) then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    if (new.details -> 'slots', new.details -> 'capacity_per_slot')
       is not distinct from (old.details -> 'slots', old.details -> 'capacity_per_slot') then
      return null;
    end if;
    if old.details ? 'slots' and not (new.details ? 'slots') then
      raise exception 'knowledge_slot_invalid' using errcode = 'P0001';
    end if;
  end if;
  -- A plain weekly draft has no slots: #2503 starts its series after inserting
  -- the draft. Existing direct-slot callers also keep their row-based path.
  if not (new.details ? 'slots') then
    return null;
  end if;
  if jsonb_typeof(v_slots) is distinct from 'array' then
    raise exception 'knowledge_slot_invalid' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_slots) not between 1 and 20 then
    raise exception 'knowledge_slot_invalid' using errcode = 'P0001';
  end if;
  -- Do not bypass the restriction on one-off slots beside a running series.
  -- After a series ends, its retained booked rows still belong to that series.
  if exists (select 1 from public.knowledge_slot_series k
              where k.post_id = new.id and k.status <> 'ended') then
    raise exception 'knowledge_series_has_slots' using errcode = 'P0001';
  end if;
  begin
    v_capacity := coalesce((new.details ->> 'capacity_per_slot')::smallint, 1);
    if v_capacity not between 1 and 20 then
      raise exception 'knowledge_slot_invalid' using errcode = 'P0001';
    end if;
    for v_slot in
      select (s ->> 'starts_at')::timestamptz as starts_at,
             (s ->> 'ends_at')::timestamptz as ends_at
        from jsonb_array_elements(v_slots) s order by 1
    loop
      if v_slot.starts_at is null or v_slot.ends_at is null
         or not isfinite(v_slot.starts_at) or not isfinite(v_slot.ends_at)
         or v_slot.ends_at <= v_slot.starts_at then
        raise exception 'knowledge_slot_invalid' using errcode = 'P0001';
      end if;
      if v_slot.ends_at - v_slot.starts_at not between interval '15 minutes' and interval '8 hours' then
        raise exception 'knowledge_slot_duration_invalid' using errcode = 'P0001';
      end if;
      if v_slot.starts_at <= now() and not exists (
        select 1 from public.post_knowledge_slots s where s.post_id = new.id
          and s.series_id is null and s.starts_at = v_slot.starts_at) then
        raise exception 'knowledge_slot_in_past' using errcode = 'P0001';
      end if;
      if v_previous_end is not null and v_slot.starts_at < v_previous_end then
        raise exception 'knowledge_slots_overlap' using errcode = 'P0001';
      end if;
      v_previous_end := v_slot.ends_at;
    end loop;
  exception
    when invalid_datetime_format or datetime_field_overflow or invalid_text_representation
         or numeric_value_out_of_range then
      raise exception 'knowledge_slot_invalid' using errcode = 'P0001';
  end;

  -- All writes keep the existing guard, including completed bookings. Start is
  -- the booking identity; retain the id of every listed existing one-off slot.
  delete from public.post_knowledge_slots s
   where s.post_id = new.id and s.series_id is null
     and not exists (select 1 from jsonb_array_elements(v_slots) w
                      where (w ->> 'starts_at')::timestamptz = s.starts_at);
  -- Shrink first, then grow. This permits moving a shared boundary without a
  -- transient exclusion violation when the final list does not overlap.
  update public.post_knowledge_slots s
     set ends_at = (w ->> 'ends_at')::timestamptz, capacity = v_capacity
    from jsonb_array_elements(v_slots) w
   where s.post_id = new.id and s.series_id is null
     and s.starts_at = (w ->> 'starts_at')::timestamptz
     and (w ->> 'ends_at')::timestamptz < s.ends_at;
  update public.post_knowledge_slots s
     set ends_at = (w ->> 'ends_at')::timestamptz, capacity = v_capacity
    from jsonb_array_elements(v_slots) w
   where s.post_id = new.id and s.series_id is null
     and s.starts_at = (w ->> 'starts_at')::timestamptz
     and (s.ends_at, s.capacity) is distinct from ((w ->> 'ends_at')::timestamptz, v_capacity);
  insert into public.post_knowledge_slots (post_id, starts_at, ends_at, capacity)
  select new.id, (w ->> 'starts_at')::timestamptz, (w ->> 'ends_at')::timestamptz, v_capacity
    from jsonb_array_elements(v_slots) w
   where not exists (select 1 from public.post_knowledge_slots s
                      where s.post_id = new.id and s.series_id is null
                        and s.starts_at = (w ->> 'starts_at')::timestamptz);
  return null;
end;
$$;
comment on function kc_private.posts_oneoff_knowledge_slots_sync() is
  'Syncs explicit one-off knowledge details.slots atomically, under slot RLS and booked-slot guards; never manages series rows.';
revoke all on function kc_private.posts_oneoff_knowledge_slots_sync() from public, anon, authenticated;
create trigger posts_oneoff_knowledge_slots_sync
  after insert or update of details on public.posts
  for each row execute function kc_private.posts_oneoff_knowledge_slots_sync();
