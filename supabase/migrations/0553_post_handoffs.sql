-- 0553_post_handoffs | G1 step 1 (ADR-006, D19 "handoff is the closing stage", BACKLOG G1-S1)
--
-- `post_handoffs` is the closing stage of every post: the same shape as `giving_handoffs`
-- (reserve → confirm → hand over, or cancel / no-show; seats for rides, slots for knowledge),
-- keyed by `post_id`. During the transition `giving_handoffs` stays the engine and every one of
-- its rows is copied here with the same `handoff_id` by trigger, so ratings and notifications
-- can be re-pointed one at a time in step 3. A handoff whose listing has no post yet (a world
-- that does not mirror, or a listing closed before 0466) is copied as soon as the post exists
-- (`listing_feed_mirror_upsert` calls `post_handoffs_sync_listing` on insert, 0551).
-- Participants read their own rows, as today; no client writes.
-- `post_unification_report()` (service_role) counts both sides and their mismatches; the SQL
-- tests assert zero and the operator runs it on kc-dev before every later step.

begin;

create table if not exists public.post_handoffs (
  handoff_id           uuid primary key default gen_random_uuid(),
  post_id              uuid not null references public.posts(post_id) on delete cascade,
  owner_id             uuid not null references public.users(user_id) on delete cascade,
  recipient_id         uuid not null references public.users(user_id) on delete cascade,
  world_slug           text not null references public.worlds(slug),
  status               text not null default 'reserved'
    check (status in ('reserved', 'confirmed', 'handed_over', 'cancelled', 'no_show')),
  cancel_reason        text
    check (cancel_reason is null or cancel_reason in ('declined', 'expired', 'passenger_cancelled', 'driver_cancelled', 'system')),
  pickup_mode          text not null default 'pickup' check (pickup_mode in ('pickup', 'delivery')),
  pickup_window_start  timestamptz,
  pickup_window_end    timestamptz,
  slot_starts_at       timestamptz,
  slot_ends_at         timestamptz,
  seats                integer not null default 1 check (seats between 1 and 8),
  confirm_by           timestamptz,
  reserved_at          timestamptz not null default now(),
  confirmed_at         timestamptz,
  handed_over_at       timestamptz,
  cancelled_at         timestamptz,
  no_show_at           timestamptz,
  constraint post_handoffs_distinct_users check (owner_id <> recipient_id)
);

comment on table public.post_handoffs is
  'Closing stage of every post (D19): who takes it, when, how many seats, and how it ended. Mirrors giving_handoffs during G1; becomes the only handoff table in step 6 (ADR-006).';

-- Items and food take one active handoff per post; rides and knowledge take several (seats / slots).
create unique index if not exists post_handoffs_active_post_uidx
  on public.post_handoffs (post_id)
  where status in ('reserved', 'confirmed') and world_slug in ('items', 'food');
create index if not exists post_handoffs_post_idx on public.post_handoffs (post_id, reserved_at desc);
create index if not exists post_handoffs_recipient_idx on public.post_handoffs (recipient_id, reserved_at desc);
create index if not exists post_handoffs_owner_idx on public.post_handoffs (owner_id, reserved_at desc);

-- ── RLS: participants only, as on giving_handoffs; clients never write ──────────────
alter table public.post_handoffs enable row level security;

drop policy if exists post_handoffs_participant_read on public.post_handoffs;
create policy post_handoffs_participant_read on public.post_handoffs
  for select to authenticated
  using (owner_id = (select auth.uid()) or recipient_id = (select auth.uid()));

revoke all on public.post_handoffs from public, anon;
revoke insert, update, delete on public.post_handoffs from authenticated;
grant select on public.post_handoffs to authenticated;

-- ── The post a listing's handoffs belong to: its mirror, else the post it was synced from ──
create or replace function public.post_id_of_listing(p_listing_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.post_id from public.posts p where p.listing_id = p_listing_id),
    (select l.legacy_post_id from public.listings l where l.listing_id = p_listing_id));
$$;

revoke all on function public.post_id_of_listing(uuid) from public, anon, authenticated;
grant execute on function public.post_id_of_listing(uuid) to service_role;

-- ── Copy one giving handoff; a no-op when its post does not exist yet ────────────────
create or replace function public.post_handoffs_upsert_from_giving(p_h public.giving_handoffs)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_id uuid := public.post_id_of_listing(p_h.listing_id);
begin
  if v_post_id is null then
    return;
  end if;
  insert into public.post_handoffs as t (
    handoff_id, post_id, owner_id, recipient_id, world_slug, status, cancel_reason, pickup_mode,
    pickup_window_start, pickup_window_end, slot_starts_at, slot_ends_at, seats, confirm_by,
    reserved_at, confirmed_at, handed_over_at, cancelled_at, no_show_at
  ) values (
    p_h.handoff_id, v_post_id, p_h.owner_id, p_h.recipient_id, p_h.world_slug, p_h.status,
    p_h.cancel_reason, p_h.pickup_mode, p_h.pickup_window_start, p_h.pickup_window_end,
    p_h.slot_starts_at, p_h.slot_ends_at, p_h.seats, p_h.confirm_by, p_h.reserved_at,
    p_h.confirmed_at, p_h.handed_over_at, p_h.cancelled_at, p_h.no_show_at
  )
  on conflict (handoff_id) do update set
    post_id             = excluded.post_id,
    owner_id            = excluded.owner_id,
    recipient_id        = excluded.recipient_id,
    world_slug          = excluded.world_slug,
    status              = excluded.status,
    cancel_reason       = excluded.cancel_reason,
    pickup_mode         = excluded.pickup_mode,
    pickup_window_start = excluded.pickup_window_start,
    pickup_window_end   = excluded.pickup_window_end,
    slot_starts_at      = excluded.slot_starts_at,
    slot_ends_at        = excluded.slot_ends_at,
    seats               = excluded.seats,
    confirm_by          = excluded.confirm_by,
    reserved_at         = excluded.reserved_at,
    confirmed_at        = excluded.confirmed_at,
    handed_over_at      = excluded.handed_over_at,
    cancelled_at        = excluded.cancelled_at,
    no_show_at          = excluded.no_show_at
  where (t.post_id, t.owner_id, t.recipient_id, t.world_slug, t.status, t.cancel_reason, t.pickup_mode,
         t.pickup_window_start, t.pickup_window_end, t.slot_starts_at, t.slot_ends_at, t.seats,
         t.confirm_by, t.reserved_at, t.confirmed_at, t.handed_over_at, t.cancelled_at, t.no_show_at)
        is distinct from
        (excluded.post_id, excluded.owner_id, excluded.recipient_id, excluded.world_slug, excluded.status,
         excluded.cancel_reason, excluded.pickup_mode, excluded.pickup_window_start, excluded.pickup_window_end,
         excluded.slot_starts_at, excluded.slot_ends_at, excluded.seats, excluded.confirm_by,
         excluded.reserved_at, excluded.confirmed_at, excluded.handed_over_at, excluded.cancelled_at,
         excluded.no_show_at);
end;
$$;

revoke all on function public.post_handoffs_upsert_from_giving(public.giving_handoffs) from public, anon, authenticated;
grant execute on function public.post_handoffs_upsert_from_giving(public.giving_handoffs) to service_role;

-- Every handoff of one listing (called when a listing first gets its post).
create or replace function public.post_handoffs_sync_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.giving_handoffs;
begin
  for h in select * from public.giving_handoffs g where g.listing_id = p_listing_id loop
    perform public.post_handoffs_upsert_from_giving(h);
  end loop;
end;
$$;

revoke all on function public.post_handoffs_sync_listing(uuid) from public, anon, authenticated;
grant execute on function public.post_handoffs_sync_listing(uuid) to service_role;

-- ── Trigger: giving_handoffs → post_handoffs on every write ─────────────────────────
create or replace function public.giving_handoffs_post_handoffs_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.post_handoffs where handoff_id = old.handoff_id;
    return old;
  end if;
  begin
    perform public.post_handoffs_upsert_from_giving(new);
  exception when others then
    raise warning 'post_handoffs: handoff % not mirrored: % (%)', new.handoff_id, sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

revoke all on function public.giving_handoffs_post_handoffs_sync() from public, anon, authenticated;

drop trigger if exists giving_handoffs_post_handoffs_sync on public.giving_handoffs;
create trigger giving_handoffs_post_handoffs_sync
  after insert or update or delete on public.giving_handoffs
  for each row execute function public.giving_handoffs_post_handoffs_sync();

-- ── Backfill ─────────────────────────────────────────────────────────────────────────
do $$
declare
  h public.giving_handoffs;
begin
  for h in select * from public.giving_handoffs order by reserved_at loop
    begin
      perform public.post_handoffs_upsert_from_giving(h);
    exception when others then
      raise warning 'post_handoffs backfill: handoff % skipped: % (%)', h.handoff_id, sqlerrm, sqlstate;
    end;
  end loop;
end $$;

-- ── Verification: counts and mismatches between the listing side and the post side ──
-- Zero in every `*_mismatches` / `*_missing` key means the two sides agree. `listings_without_post`
-- lists, per world, listings that have no post yet (step 2 gives every listing one).
create or replace function public.post_unification_report()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with mirrors as (
    select p.*, l.world_slug as l_world, l.direction as l_direction, l.expires_at as l_expires_at,
           l.details as l_details, l.category_id as l_category_id, l.geo as l_geo,
           l.time_window as l_time_window, l.urgency_level as l_urgency_level,
           public.listing_feed_mirror_status(l) as l_status
      from public.posts p
      join public.listings l on l.listing_id = p.listing_id
  ),
  without_post as (
    select l.world_slug, count(*) as n
      from public.listings l
     where public.post_id_of_listing(l.listing_id) is null
     group by l.world_slug
  ),
  ride_pairs as (
    select p.post_id as mirror_post_id, l.details as d, r.*
      from public.posts p
      join public.listings l on l.listing_id = p.listing_id and l.world_slug = 'rides'
      left join public.ride_post_details r on r.post_id = p.post_id
  ),
  handoff_pairs as (
    select g.*, t.handoff_id as t_id, t.post_id as t_post_id, t.status as t_status, t.seats as t_seats,
           t.recipient_id as t_recipient_id, t.confirmed_at as t_confirmed_at,
           t.handed_over_at as t_handed_over_at, t.cancelled_at as t_cancelled_at,
           public.post_id_of_listing(g.listing_id) as expected_post_id
      from public.giving_handoffs g
      left join public.post_handoffs t on t.handoff_id = g.handoff_id
  )
  select jsonb_build_object(
    'generated_at', now(),
    'listings_total', (select count(*) from public.listings),
    'listings_with_post', (select count(*) from public.listings l where public.post_id_of_listing(l.listing_id) is not null),
    'listings_without_post', coalesce((select jsonb_object_agg(world_slug, n) from without_post), '{}'::jsonb),
    'posts_total', (select count(*) from public.posts),
    'posts_mirrors', (select count(*) from mirrors),
    'mirror_field_mismatches', (
      select count(*) from mirrors m
       where (m.world_slug, m.direction, m.expires_at, m.details, m.category_id, m.time_window,
              m.urgency_level, m.status, m.geo::text)
             is distinct from
             (m.l_world, case m.l_direction when 'request' then 'request' else 'offer' end,
              m.l_expires_at, coalesce(m.l_details, '{}'::jsonb), m.l_category_id, m.l_time_window,
              m.l_urgency_level, m.l_status, m.l_geo::text)),
    'ride_posts_total', (select count(*) from ride_pairs),
    'ride_details_missing', (select count(*) from ride_pairs where post_id is null),
    'ride_field_mismatches', (
      select count(*) from ride_pairs rp
       where rp.departs_at is not null
         and (rp.departs_at, rp.seats_available, rp.origin_place_id, rp.dest_place_id, rp.arrives_at)
             is distinct from
             (nullif(rp.d ->> 'departs_at', '')::timestamptz, nullif(rp.d ->> 'seats_available', '')::integer,
              rp.d ->> 'origin_place_id', rp.d ->> 'dest_place_id', nullif(rp.d ->> 'arrives_at', '')::timestamptz)),
    'handoffs_total', (select count(*) from public.giving_handoffs),
    'post_handoffs_total', (select count(*) from public.post_handoffs),
    'handoffs_without_post', (select count(*) from handoff_pairs where expected_post_id is null),
    'handoff_rows_missing', (select count(*) from handoff_pairs where expected_post_id is not null and t_id is null),
    'handoff_field_mismatches', (
      select count(*) from handoff_pairs hp
       where hp.t_id is not null
         and (hp.t_post_id, hp.t_status, hp.t_seats, hp.t_recipient_id, hp.t_confirmed_at, hp.t_handed_over_at, hp.t_cancelled_at)
             is distinct from
             (hp.expected_post_id, hp.status, hp.seats, hp.recipient_id, hp.confirmed_at, hp.handed_over_at, hp.cancelled_at))
  );
$$;

comment on function public.post_unification_report() is
  'G1 verification: row counts of listings / posts / handoffs on both sides and the mismatches between them (ADR-006). service_role only.';

revoke all on function public.post_unification_report() from public, anon, authenticated;
grant execute on function public.post_unification_report() to service_role;

commit;
