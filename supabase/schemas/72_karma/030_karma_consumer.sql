-- Karma · consumer of outbox topic `karma`
--
-- No write path computes karma. A module records what happened on topic `karma` and this
-- consumer turns it into ledger entries, so a member's request never waits for it and a
-- failed award never rolls back a handoff. Events (payload.kind):
--   handoff_completed   { handoff_id, post_id, owner_id, recipient_id, world_slug, post_type,
--                         direction, seats }                       (25_handoffs/030)
--   handoff_reverted    the same payload: the delivery was taken back
--   rating_given        { handoff_id, post_id, rater_id }         (25_handoffs/110)
--   award               { event_type, context?, user_id, subject, quantity? } — any module:
--                       pays karma_values(event_type, context) once for the subject
--   revoke              { user_id, subject_prefix } — reverses what the member holds
-- Performing an event twice changes nothing: every entry carries the event's id as its
-- reference, and an award is skipped while its subject still holds points.

-- Performs one event. Returns the net points written (negative for a reversal).
create function kc_private.karma_deliver(p_event_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_reference constant text := 'event:' || p_event_id;
  v_subject text;
  v_context text;
  v_giver_id uuid;
  v_receiver_id uuid;
  v_quantity jsonb;
begin
  select e.payload into v_payload
    from kc_private.outbox_events e
   where e.id = p_event_id and e.topic = 'karma';
  if not found then
    raise exception 'outbox_event_not_found' using errcode = 'P0001';
  end if;

  case v_payload ->> 'kind'
  when 'handoff_completed' then
    v_subject := 'handoff:' || (v_payload ->> 'handoff_id') || ':';
    v_context := case when v_payload ->> 'post_type' in ('ride', 'housing_stay', 'event')
                      then v_payload ->> 'post_type' else v_payload ->> 'world_slug' end;
    -- On an offer the owner gives and the other member receives; on a request the reverse.
    if v_payload ->> 'direction' = 'offer' then
      v_giver_id := (v_payload ->> 'owner_id')::uuid;
      v_receiver_id := (v_payload ->> 'recipient_id')::uuid;
    else
      v_giver_id := (v_payload ->> 'recipient_id')::uuid;
      v_receiver_id := (v_payload ->> 'owner_id')::uuid;
    end if;
    -- What was given, in every unit a value may be configured in. The estimated value of
    -- an item is a field of the post's details (FR-KARMA-004), capped at 1,000 ILS.
    select jsonb_strip_nulls(jsonb_build_object(
             'night', ceil(extract(epoch from h.slot_ends_at - h.slot_starts_at) / 86400),
             'half_hour', ceil(extract(epoch from h.slot_ends_at - h.slot_starts_at) / 1800),
             'value_50_ils', case when p.details ->> 'estimated_value' ~ '^\d{1,6}$'
               then round(least((p.details ->> 'estimated_value')::integer, 1000) / 50.0) end))
      into v_quantity
      from public.post_handoffs h
      join public.posts p on p.id = h.post_id
     where h.id = (v_payload ->> 'handoff_id')::uuid;

    return kc_private.karma_award(
             v_giver_id, 'handoff_giver', v_context, v_subject || 'giver', v_reference, v_quantity)
         + kc_private.karma_award(
             v_giver_id, 'item_value_bonus', v_context, v_subject || 'value_bonus', v_reference, v_quantity)
         + kc_private.karma_award(
             v_receiver_id, 'handoff_receiver', v_context, v_subject || 'receiver', v_reference, v_quantity);

  when 'handoff_reverted' then
    v_subject := 'handoff:' || (v_payload ->> 'handoff_id') || ':';
    return kc_private.karma_revoke((v_payload ->> 'owner_id')::uuid, v_subject, v_reference)
         + kc_private.karma_revoke((v_payload ->> 'recipient_id')::uuid, v_subject, v_reference);

  when 'rating_given' then
    return kc_private.karma_award(
      (v_payload ->> 'rater_id')::uuid, 'rating_given', '',
      'rating:' || (v_payload ->> 'handoff_id'), v_reference);

  when 'award' then
    return kc_private.karma_award(
      (v_payload ->> 'user_id')::uuid, v_payload ->> 'event_type', v_payload ->> 'context',
      v_payload ->> 'subject', v_reference, coalesce(v_payload -> 'quantity', '{}'::jsonb));

  when 'revoke' then
    return kc_private.karma_revoke(
      (v_payload ->> 'user_id')::uuid, v_payload ->> 'subject_prefix', v_reference);

  else
    raise exception 'invalid_karma_event' using errcode = 'P0001';
  end case;
end;
$$;
comment on function kc_private.karma_deliver(bigint) is
  'Consumer of outbox topic karma: writes the ledger entries of one event; safe to repeat.';

-- Worker entry point: claims due events of the topic, performs each and confirms it. A
-- failing event is released for a retry with its error and does not stop the batch.
-- Returns the number of events performed. Needs no service outside the database, so it is
-- run by a scheduled job.
create function kc_private.karma_process(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id bigint;
  v_done integer := 0;
begin
  for v_event_id in
    select e.id from kc_private.outbox_claim('karma', p_limit) e order by e.id
  loop
    begin
      perform kc_private.karma_deliver(v_event_id);
      perform kc_private.outbox_complete(v_event_id);
      v_done := v_done + 1;
    exception when others then
      perform kc_private.outbox_complete(v_event_id, sqlerrm);
    end;
  end loop;
  return v_done;
end;
$$;
comment on function kc_private.karma_process(integer) is
  'Claims and performs a batch of karma events; run by a scheduled job.';

-- ── Nightly reconciliation (FR-KARMA-001 AC3, design §5 "Counters") ─────────────────────

-- One row per total that did not match its ledger. Ids only; kept for diagnosis.
create table ops.karma_drift (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  stored      integer not null,
  computed    integer not null,
  detected_at timestamptz not null default now()
);
comment on table ops.karma_drift is 'Karma totals that differed from the ledger sum when the nightly job corrected them.';

alter table ops.karma_drift enable row level security;
alter table ops.karma_drift force row level security;

-- Sets every member's total to the sum of their ledger (never below zero) and records each
-- total it had to correct. Returns the number of corrections.
create function kc_private.karma_reconcile()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixed integer;
begin
  with ledger as (
    select l.user_id, greatest(sum(l.points), 0)::integer as points
      from public.karma_ledger l
     group by l.user_id
  ), fixed as (
    update public.user_stats s
       set karma_points = coalesce(g.points, 0)
      from public.user_stats c
      left join ledger g on g.user_id = c.user_id
     where s.user_id = c.user_id and s.karma_points <> coalesce(g.points, 0)
    returning s.user_id, c.karma_points as stored, s.karma_points as computed
  )
  insert into ops.karma_drift (user_id, stored, computed)
  select f.user_id, f.stored, f.computed from fixed f;
  get diagnostics v_fixed = row_count;
  return v_fixed;
end;
$$;
comment on function kc_private.karma_reconcile() is
  'Nightly: corrects karma totals from the ledger and records every drift in ops.karma_drift.';
