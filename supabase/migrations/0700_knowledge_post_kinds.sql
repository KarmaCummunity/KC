-- 0700_knowledge_post_kinds | #2034 (epic #1687, KNOW-K1-B 1/6) · FR-KNOW-003, FR-KNOW-004 AC1,
-- FR-KNOW-012 AC1 (docs/spec/requirements/23_knowledge.md) · docs/spec/18_knowledge_world.md §18.4.
--
-- The knowledge world gets the six exchange post kinds of the spec and real time slots:
--   1. listing_kinds   lesson_offer · mentoring_offer · consulting_hour (offer) and
--                      learning_request · mentoring_request · question (request), each with its
--                      binding detail schema. The legacy course / private_lesson /
--                      mentorship_request kinds are deactivated, never renamed or deleted, so a
--                      closed post keeps the kind it was published with.
--   2. knowledge_slots one row per bookable time of a lesson offer or a consulting hour. The post's
--                      `details.slots` is what the owner edits; the rows are what learners book.
--   3. post_handoffs.knowledge_slot_id  the slot a booking holds a seat on.
--   4. posts_world_knowledge_rules  BEFORE trigger: slot validation, the offer's expiry (30 min
--                      after its last slot ends), the identity check of a consulting hour.
--   5. posts_knowledge_slots_sync   AFTER trigger: details.slots → knowledge_slots, refusing any
--                      edit that would strand a learner (remove, move or shrink a booked slot).
--   6. Data: open legacy lesson / course posts become lesson offers with one slot each; open
--      mentorship requests become mentoring requests; existing bookings point at their slot.
--   7. karma_handoff_points gains the knowledge values of spec 07 §7.6 (S72).
--
-- Must sort after 0667 / 0684 (post triggers) and 0694 (handoff FSM), hence the 0700 block.
-- Additive: no table, column or function is dropped.

begin;

-- ── 1. The six kinds ──────────────────────────────────────────────────────────────────────────
-- Shared schema fragments. `topic` is a free-text subject kept until the topic graph is linked to
-- posts (#2036); `language` lists the languages the session is given in.
create temp table _kk_fragments on commit drop as
select
  '{"type":"string","minLength":2,"maxLength":80}'::jsonb as topic,
  '{"enum":["beginner","intermediate","advanced"]}'::jsonb as level,
  '{"enum":["in_person","video","phone"]}'::jsonb as modality,
  '{"type":"array","uniqueItems":true,"maxItems":5,"items":{"enum":["he","en","ar","ru","am","fr","es","other"]}}'::jsonb as language,
  '{"type":"string","maxLength":280}'::jsonb as note,
  -- One bookable time. Ordering, duration and overlap rules are enforced by the trigger below,
  -- because JSON schema cannot compare two values.
  '{"type":"array","minItems":1,"maxItems":20,"items":{"type":"object","additionalProperties":false,
    "required":["starts_at","ends_at"],
    "properties":{"starts_at":{"type":"string","minLength":10},"ends_at":{"type":"string","minLength":10}}}}'::jsonb as slots,
  '{"enum":["weekly","biweekly","monthly","flexible"]}'::jsonb as cadence;

insert into public.listing_kinds (world_slug, slug, label_he, label_en, direction, detail_schema, sort_order)
select 'knowledge', v.slug, v.label_he, v.label_en, v.direction, v.schema, v.ord
  from _kk_fragments f
 cross join lateral (values
   ('lesson_offer', 'שיעור', 'Lesson', 'give', 10, jsonb_build_object(
      'type', 'object', 'additionalProperties', false,
      'required', jsonb_build_array('modality', 'capacity_per_slot', 'slots'),
      'properties', jsonb_build_object(
        'topic', f.topic, 'level', f.level, 'modality', f.modality, 'language', f.language,
        'capacity_per_slot', '{"type":"integer","minimum":1,"maximum":20}'::jsonb,
        'slots', f.slots, 'availability_note', f.note,
        'resource_ids', '{"type":"array","uniqueItems":true,"maxItems":10,"items":{"type":"string","minLength":36,"maxLength":36}}'::jsonb))),
   ('mentoring_offer', 'חונכות', 'Mentoring', 'give', 11, jsonb_build_object(
      'type', 'object', 'additionalProperties', false,
      'required', jsonb_build_array('cadence', 'seats', 'modality'),
      'properties', jsonb_build_object(
        'topic', f.topic, 'level', f.level, 'modality', f.modality, 'language', f.language,
        'audience', '{"type":"array","uniqueItems":true,"maxItems":6,"items":{"enum":["career_change","students","new_immigrants","youth_18plus","seniors","other"]}}'::jsonb,
        'cadence', f.cadence,
        'seats', '{"type":"integer","minimum":1,"maximum":10}'::jsonb,
        'availability_note', f.note))),
   ('consulting_hour', 'שעת ייעוץ', 'Consulting hour', 'give', 12, jsonb_build_object(
      'type', 'object', 'additionalProperties', false,
      'required', jsonb_build_array('profession', 'modality', 'capacity_per_slot', 'slots', 'disclaimer_accepted'),
      'properties', jsonb_build_object(
        'topic', f.topic, 'modality', f.modality, 'language', f.language,
        'profession', '{"enum":["lawyer","accountant","tax_advisor","social_worker","employment_rights","housing_rights","consumer_rights","other"]}'::jsonb,
        'capacity_per_slot', '{"type":"integer","minimum":1,"maximum":5}'::jsonb,
        'slots', f.slots, 'availability_note', f.note,
        -- D40: the giver accepts that this is general information, not binding advice.
        'disclaimer_accepted', '{"const":true}'::jsonb))),
   ('learning_request', 'רוצה ללמוד', 'Want to learn', 'request', 13, jsonb_build_object(
      'type', 'object', 'additionalProperties', false,
      'properties', jsonb_build_object(
        'topic', f.topic, 'level', f.level, 'preferred_modality', f.modality,
        'language', f.language, 'availability_note', f.note))),
   ('mentoring_request', 'מחפש/ת מנטור', 'Looking for a mentor', 'request', 14, jsonb_build_object(
      'type', 'object', 'additionalProperties', false,
      'properties', jsonb_build_object(
        'topic', f.topic, 'level', f.level, 'preferred_modality', f.modality, 'language', f.language,
        'goal', f.note, 'cadence', f.cadence))),
   -- The question itself is the post's title and description; the details only add context.
   ('question', 'שאלה', 'Question', 'request', 15, jsonb_build_object(
      'type', 'object', 'additionalProperties', false,
      'properties', jsonb_build_object(
        'topic', f.topic,
        'context_url', '{"type":"string","pattern":"^https?://","maxLength":500}'::jsonb)))
 ) as v(slug, label_he, label_en, direction, ord, schema)
on conflict (world_slug, slug) do update
  set detail_schema = excluded.detail_schema,
      label_he = excluded.label_he,
      label_en = excluded.label_en,
      direction = excluded.direction,
      sort_order = excluded.sort_order,
      is_active = true;

-- The legacy kinds stop being offered; posts published with them keep their kind.
update public.listing_kinds
   set is_active = false
 where world_slug = 'knowledge'
   and slug in ('course', 'private_lesson', 'mentorship_request')
   and is_active;

-- ── 2. Slots ──────────────────────────────────────────────────────────────────────────────────
create table if not exists public.knowledge_slots (
  slot_id    uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(post_id) on delete cascade,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  -- Seats on this slot; booked seats are counted from post_handoffs, never stored, so they can
  -- never drift from the bookings themselves.
  capacity   smallint not null check (capacity between 1 and 20),
  -- 'cancelled' = removed by the owner; full / past are derived (seats, times).
  status     text not null default 'open' check (status in ('open', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_slots_ends_after_start check (ends_at > starts_at)
);

-- One open slot per start time of a post: the sync matches details.slots to rows by start.
create unique index if not exists knowledge_slots_post_start_open_uidx
  on public.knowledge_slots (post_id, starts_at) where status = 'open';
create index if not exists knowledge_slots_upcoming_idx
  on public.knowledge_slots (starts_at) where status = 'open';

drop trigger if exists knowledge_slots_set_updated_at on public.knowledge_slots;
create trigger knowledge_slots_set_updated_at
  before update on public.knowledge_slots
  for each row execute function public.set_updated_at();

alter table public.knowledge_slots enable row level security;
-- Readable wherever the post is; written only by the sync trigger (no client DML policies).
drop policy if exists knowledge_slots_select_visible on public.knowledge_slots;
create policy knowledge_slots_select_visible on public.knowledge_slots
  for select to anon, authenticated
  using (exists (
    select 1 from public.posts p
     where p.post_id = knowledge_slots.post_id
       and public.is_post_visible_to(p, auth.uid())
  ));

alter table public.post_handoffs
  add column if not exists knowledge_slot_id uuid
    references public.knowledge_slots(slot_id) on delete set null;
create index if not exists post_handoffs_knowledge_slot_idx
  on public.post_handoffs (knowledge_slot_id) where knowledge_slot_id is not null;

-- ── 3. Rules shared by the triggers ───────────────────────────────────────────────────────────
-- Kinds whose details carry bookable slots.
create or replace function public.knowledge_kind_has_slots(p_kind_slug text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_kind_slug in ('lesson_offer', 'consulting_hour');
$$;

-- Seats held on a slot: a reserved, confirmed or completed booking keeps its seat.
create or replace function public.knowledge_slot_seats_taken(p_slot_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.post_handoffs h
   where h.knowledge_slot_id = p_slot_id
     and h.status in ('reserved', 'confirmed', 'handed_over');
$$;

-- Validates `details.slots` of a post and returns the end of its last slot. A slot that is not an
-- open row of the post yet is new and must still lie in the future; an existing slot may already
-- have passed (an owner editing the note of a running series must not be refused). Errors
-- (23514): knowledge_slot_invalid, knowledge_slot_duration_invalid, knowledge_slot_in_past,
-- knowledge_slots_overlap.
create or replace function public.knowledge_check_slots(p_post_id uuid, p_details jsonb)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slot   record;
  v_prev_end timestamptz;
  v_last   timestamptz;
begin
  if jsonb_typeof(p_details->'slots') is distinct from 'array'
     or jsonb_array_length(p_details->'slots') not between 1 and 20 then
    raise exception 'knowledge_slot_invalid' using errcode = '23514';
  end if;

  for v_slot in
    select (s->>'starts_at')::timestamptz as starts_at, (s->>'ends_at')::timestamptz as ends_at
      from jsonb_array_elements(p_details->'slots') s
     order by 1
  loop
    if v_slot.starts_at is null or v_slot.ends_at is null or v_slot.ends_at <= v_slot.starts_at then
      raise exception 'knowledge_slot_invalid' using errcode = '23514';
    end if;
    -- A session is 15 minutes to 8 hours (karma counts at most 8 hours a post, S14).
    if v_slot.ends_at - v_slot.starts_at not between interval '15 minutes' and interval '8 hours' then
      raise exception 'knowledge_slot_duration_invalid' using errcode = '23514';
    end if;
    if v_slot.starts_at <= now() and not exists (
      select 1 from public.knowledge_slots k
       where k.post_id = p_post_id and k.starts_at = v_slot.starts_at and k.status = 'open'
    ) then
      raise exception 'knowledge_slot_in_past' using errcode = '23514';
    end if;
    if v_prev_end is not null and v_slot.starts_at < v_prev_end then
      raise exception 'knowledge_slots_overlap' using errcode = '23514';
    end if;
    v_prev_end := v_slot.ends_at;
    v_last := greatest(coalesce(v_last, v_slot.ends_at), v_slot.ends_at);
  end loop;
  return v_last;
exception
  when invalid_datetime_format or datetime_field_overflow then
    raise exception 'knowledge_slot_invalid' using errcode = '23514';
end;
$$;

-- ── 4. BEFORE trigger: rules of a knowledge post ──────────────────────────────────────────────
-- Fires after posts_before_write_world_rules (trigger names sort alphabetically), so the expiry it
-- sets is final, and before trg_posts_validate_details_schema checks the schema.
create or replace function public.posts_world_knowledge_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_kind_changed boolean := tg_op = 'INSERT' or old.kind_id is distinct from new.kind_id;
begin
  if new.world_slug <> 'knowledge' or coalesce(new.source, 'native') <> 'native' then
    return new;
  end if;
  select slug into v_kind from public.listing_kinds where kind_id = new.kind_id;
  if v_kind is null or v_kind not in ('lesson_offer', 'mentoring_offer', 'consulting_hour',
                                      'learning_request', 'mentoring_request', 'question') then
    return new; -- a legacy kind keeps its legacy rules
  end if;

  -- FR-KNOW-012 AC1 (S70): professional advice only from an identity-verified member.
  if v_kind = 'consulting_hour' and v_kind_changed
     and public.user_verification_level(new.owner_id) < 2 then
    raise exception 'consulting_requires_id_verification' using errcode = '42501';
  end if;

  -- FR-KNOW-003 AC3 (D21): a slotted offer closes 30 minutes after its last slot; every other
  -- knowledge post never expires and gets relevance reminders instead (D59).
  if public.knowledge_kind_has_slots(v_kind) then
    new.expires_at := public.knowledge_check_slots(new.post_id, new.details) + interval '30 minutes';
  else
    new.expires_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_world_knowledge_rules on public.posts;
create trigger posts_world_knowledge_rules
  before insert or update of details, kind_id on public.posts
  for each row when (new.world_slug = 'knowledge')
  execute function public.posts_world_knowledge_rules();

-- ── 5. AFTER trigger: details.slots → knowledge_slots ─────────────────────────────────────────
-- Rows are matched by start time. A slot that disappears from details is cancelled; a slot with a
-- reserved or confirmed booking cannot disappear or change its end (knowledge_slot_has_booking),
-- and a capacity below the seats already held is refused (knowledge_slot_capacity_below_bookings).
create or replace function public.posts_knowledge_slots_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind     text;
  v_capacity smallint;
  v_wanted   jsonb := '[]'::jsonb;
  v_row      public.knowledge_slots;
  v_slot     record;
begin
  select slug into v_kind from public.listing_kinds where kind_id = new.kind_id;
  if public.knowledge_kind_has_slots(v_kind) then
    v_wanted := coalesce(new.details->'slots', '[]'::jsonb);
    v_capacity := coalesce((new.details->>'capacity_per_slot')::smallint, 1);
  elsif v_kind in ('course', 'private_lesson')
        and nullif(new.details->>'slot_starts_at', '') is not null
        and nullif(new.details->>'slot_ends_at', '') is not null then
    -- A legacy one-slot post keeps its slot as a row, so every bookable knowledge post books the
    -- same way. Legacy capacity went up to 50; a slot holds at most 20.
    v_wanted := jsonb_build_array(jsonb_build_object(
      'starts_at', new.details->>'slot_starts_at', 'ends_at', new.details->>'slot_ends_at'));
    v_capacity := least(greatest(coalesce((new.details->>'slots_available')::int, 1), 1), 20)::smallint;
  end if;

  -- Open rows the details no longer list.
  for v_row in
    select k.* from public.knowledge_slots k
     where k.post_id = new.post_id and k.status = 'open'
       and not exists (select 1 from jsonb_array_elements(v_wanted) s
                        where (s->>'starts_at')::timestamptz = k.starts_at)
  loop
    if exists (select 1 from public.post_handoffs h
                where h.knowledge_slot_id = v_row.slot_id and h.status in ('reserved', 'confirmed')) then
      raise exception 'knowledge_slot_has_booking' using errcode = '23514';
    end if;
    update public.knowledge_slots set status = 'cancelled' where slot_id = v_row.slot_id;
  end loop;

  -- Listed slots: insert the new ones, update end and capacity of the existing ones.
  for v_slot in
    select (s->>'starts_at')::timestamptz as starts_at, (s->>'ends_at')::timestamptz as ends_at
      from jsonb_array_elements(v_wanted) s
  loop
    select * into v_row from public.knowledge_slots
     where post_id = new.post_id and starts_at = v_slot.starts_at and status = 'open';
    if not found then
      insert into public.knowledge_slots (post_id, starts_at, ends_at, capacity)
      values (new.post_id, v_slot.starts_at, v_slot.ends_at, v_capacity);
      continue;
    end if;
    if v_row.ends_at <> v_slot.ends_at and exists (
      select 1 from public.post_handoffs h
       where h.knowledge_slot_id = v_row.slot_id and h.status in ('reserved', 'confirmed')
    ) then
      raise exception 'knowledge_slot_has_booking' using errcode = '23514';
    end if;
    if v_capacity < public.knowledge_slot_seats_taken(v_row.slot_id) then
      raise exception 'knowledge_slot_capacity_below_bookings' using errcode = '23514';
    end if;
    update public.knowledge_slots
       set ends_at = v_slot.ends_at, capacity = v_capacity
     where slot_id = v_row.slot_id
       and (ends_at, capacity) is distinct from (v_slot.ends_at, v_capacity);
  end loop;
  return null;
end;
$$;

drop trigger if exists posts_knowledge_slots_sync on public.posts;
create trigger posts_knowledge_slots_sync
  after insert or update of details, kind_id on public.posts
  for each row when (new.world_slug = 'knowledge' and coalesce(new.source, 'native') = 'native')
  execute function public.posts_knowledge_slots_sync();

-- ── 6. Data: legacy open posts move to the new kinds ──────────────────────────────────────────
-- Slot rows are written first, so the rules trigger sees each legacy slot as existing and does
-- not refuse one that already passed (the offer then simply expires on the next sweep).
insert into public.knowledge_slots (post_id, starts_at, ends_at, capacity)
select p.post_id,
       (p.details->>'slot_starts_at')::timestamptz,
       (p.details->>'slot_ends_at')::timestamptz,
       least(greatest(coalesce((p.details->>'slots_available')::int, 1), 1), 20)::smallint
  from public.posts p
  join public.listing_kinds k on k.kind_id = p.kind_id
 where p.world_slug = 'knowledge'
   and k.slug in ('course', 'private_lesson')
   and p.status in ('open', 'paused', 'hidden_pending_review')
   and nullif(p.details->>'slot_starts_at', '') is not null
   and nullif(p.details->>'slot_ends_at', '') is not null
   and (p.details->>'slot_ends_at')::timestamptz > (p.details->>'slot_starts_at')::timestamptz
on conflict do nothing;

update public.posts p
   set kind_id = (select kind_id from public.listing_kinds where world_slug = 'knowledge' and slug = 'lesson_offer'),
       details = jsonb_strip_nulls(jsonb_build_object(
         'topic', nullif(p.details->>'topic', ''),
         'level', p.details->'level',
         'modality', coalesce(p.details->'modality', '"in_person"'::jsonb),
         'availability_note', p.details->'availability_note',
         'capacity_per_slot', least(greatest(coalesce((p.details->>'slots_available')::int, 1), 1), 20),
         'slots', jsonb_build_array(jsonb_build_object(
           'starts_at', p.details->>'slot_starts_at', 'ends_at', p.details->>'slot_ends_at'))))
  from public.listing_kinds k
 where k.kind_id = p.kind_id
   and p.world_slug = 'knowledge'
   and k.slug in ('course', 'private_lesson')
   and p.status in ('open', 'paused', 'hidden_pending_review')
   and exists (select 1 from public.knowledge_slots s where s.post_id = p.post_id and s.status = 'open');

update public.posts p
   set kind_id = (select kind_id from public.listing_kinds where world_slug = 'knowledge' and slug = 'mentoring_request'),
       details = jsonb_strip_nulls(jsonb_build_object(
         'topic', nullif(p.details->>'topic', ''),
         'level', case when p.details->>'level' in ('beginner', 'intermediate', 'advanced')
                       then p.details->'level' end,
         'preferred_modality', p.details->'preferred_modality'))
  from public.listing_kinds k
 where k.kind_id = p.kind_id
   and p.world_slug = 'knowledge'
   and k.slug = 'mentorship_request'
   and p.status in ('open', 'paused', 'hidden_pending_review');

-- Existing knowledge bookings hold a seat on the slot of their post.
update public.post_handoffs h
   set knowledge_slot_id = s.slot_id
  from public.knowledge_slots s
 where h.world_slug = 'knowledge'
   and h.knowledge_slot_id is null
   and s.post_id = h.post_id
   and s.status = 'open'
   and s.starts_at = h.slot_starts_at;

-- ── 7. Karma (spec 07 §7.6, S72) ──────────────────────────────────────────────────────────────
-- Knowledge: the giver earns per half hour of the session (10 an hour), the learner 5 once.
create or replace function public.karma_handoff_points(p_world text, p_role text)
returns integer
language sql
immutable
as $$
  select case p_world
    when 'items'     then case p_role when 'giver' then 20 else 15 end
    when 'food'      then case p_role when 'giver' then 20 else 10 end
    when 'rides'     then case p_role when 'giver' then 25 else 10 end
    -- Hosting: per night for the host, once for the guest (§7.6 "host 30 / night; guest 10").
    when 'housing'   then case p_role when 'giver' then 30 else 10 end
    -- Knowledge: per started half hour for the giver, once for the learner (0700).
    when 'knowledge' then case p_role when 'giver' then 5 else 5 end
    else case p_role when 'giver' then 5 else 3 end
  end;
$$;

-- ── 8. Privileges (0520: explicit per function) ───────────────────────────────────────────────
revoke all on function public.knowledge_kind_has_slots(text) from public, anon, authenticated;
grant execute on function public.knowledge_kind_has_slots(text) to service_role;
revoke all on function public.knowledge_slot_seats_taken(uuid) from public, anon, authenticated;
grant execute on function public.knowledge_slot_seats_taken(uuid) to service_role;
revoke all on function public.knowledge_check_slots(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.knowledge_check_slots(uuid, jsonb) to service_role;
revoke all on function public.posts_world_knowledge_rules() from public, anon, authenticated;
revoke all on function public.posts_knowledge_slots_sync() from public, anon, authenticated;

comment on table public.knowledge_slots is
  'FR-KNOW-004 (0700): bookable times of a knowledge lesson offer or consulting hour, synced from posts.details.slots.';

commit;
