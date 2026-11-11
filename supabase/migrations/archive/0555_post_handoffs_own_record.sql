-- 0555_post_handoffs_own_record.sql | G1 step 3a (ADR-006, D19, D104): `post_handoffs` is the
-- handoff record for the items and food flows.
--
-- Step 1 (0553) copied every `giving_handoffs` row into `post_handoffs` under the post it closes.
-- Step 2 (0554) made the post the record of every listing world. This step turns the handoff
-- around the same way for the flows that reserve, claim, confirm, hand over and cancel an item or
-- a food offer, plus the two sweeps that end them:
--
--   * the RPCs write `post_handoffs`; a guarded sync derives the `giving_handoffs` row (same
--     `handoff_id`), so every listing-side rule and side effect keeps running on the derived row:
--     the hourly write cap (0534), the cancel-reason default (0511), the push notifications (0528),
--     the readers (`get_listing_handoff`, `list_my_giving_handoffs`, ratings) and the app's
--     return type, which is still `giving_handoffs`;
--   * the 0553 sync (giving → post) stays, so the flows that have not moved yet (rides, knowledge,
--     direct inserts) keep their copy; both directions compare before writing, so a write on
--     either side converges in one hop and the echo is a no-op;
--   * every RPC accepts a post id or a listing id in its `p_listing_id` argument, so the one
--     detail screen (step 4) can call them with the post id while the marketplace screens keep
--     passing listing ids. Signatures, returned rows and error codes are unchanged.
--
-- Karma stays `karma_award_handoff` on hand-over (0453); the one closing system (G34) is step 3c.
-- Additive and idempotent: no column, table or row is removed.

begin;

-- ── Id resolution ─────────────────────────────────────────────────────────────────────────────

-- The listing derived from a post: the mirror pointer for the listing worlds (0466 / 0554), the
-- `legacy_post_id` link for items (0243).
create or replace function public.listing_id_of_post(p_post_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.listing_id from public.posts p where p.post_id = p_post_id),
    (select l.listing_id from public.listings l where l.legacy_post_id = p_post_id));
$$;

comment on function public.listing_id_of_post(uuid) is
  'G1: the listing derived from a post (mirror pointer or legacy_post_id link); null when the post has none.';

revoke all on function public.listing_id_of_post(uuid) from public, anon, authenticated;
grant execute on function public.listing_id_of_post(uuid) to service_role;

-- A handoff RPC argument is a post id (the one detail screen) or a listing id (the marketplace
-- screens): either resolves to the post the handoff closes.
create or replace function public.handoff_target_post_id(p_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.post_id from public.posts p where p.post_id = p_id),
    public.post_id_of_listing(p_id));
$$;

comment on function public.handoff_target_post_id(uuid) is
  'G1: resolves a post id or a listing id to the post a handoff closes; null when neither exists.';

revoke all on function public.handoff_target_post_id(uuid) from public, anon, authenticated;
grant execute on function public.handoff_target_post_id(uuid) to service_role;

-- ── post_handoffs → giving_handoffs (the derived side) ────────────────────────────────────────

create or replace function public.giving_handoff_upsert_from_post_handoff(p_h public.post_handoffs)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing_id uuid := public.listing_id_of_post(p_h.post_id);
begin
  if v_listing_id is null then
    -- Every post of a handoff world carries a derived listing (0243 / 0554); a missing one is
    -- reported by post_unification_report, not hidden by a failed handoff.
    raise warning 'giving_handoffs: handoff % of post % has no listing to mirror to', p_h.handoff_id, p_h.post_id;
    return;
  end if;
  insert into public.giving_handoffs as g (
    handoff_id, listing_id, owner_id, recipient_id, world_slug, status, cancel_reason, pickup_mode,
    pickup_window_start, pickup_window_end, slot_starts_at, slot_ends_at, seats, confirm_by,
    reserved_at, confirmed_at, handed_over_at, cancelled_at, no_show_at
  ) values (
    p_h.handoff_id, v_listing_id, p_h.owner_id, p_h.recipient_id, p_h.world_slug, p_h.status,
    p_h.cancel_reason, p_h.pickup_mode, p_h.pickup_window_start, p_h.pickup_window_end,
    p_h.slot_starts_at, p_h.slot_ends_at, p_h.seats, p_h.confirm_by, p_h.reserved_at,
    p_h.confirmed_at, p_h.handed_over_at, p_h.cancelled_at, p_h.no_show_at
  )
  on conflict (handoff_id) do update set
    listing_id          = excluded.listing_id,
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
  -- The guard ends the echo: the 0553 sync writes the derived values back and finds them equal.
  where (g.listing_id, g.owner_id, g.recipient_id, g.world_slug, g.status, g.cancel_reason, g.pickup_mode,
         g.pickup_window_start, g.pickup_window_end, g.slot_starts_at, g.slot_ends_at, g.seats,
         g.confirm_by, g.reserved_at, g.confirmed_at, g.handed_over_at, g.cancelled_at, g.no_show_at)
        is distinct from
        (excluded.listing_id, excluded.owner_id, excluded.recipient_id, excluded.world_slug, excluded.status,
         excluded.cancel_reason, excluded.pickup_mode, excluded.pickup_window_start, excluded.pickup_window_end,
         excluded.slot_starts_at, excluded.slot_ends_at, excluded.seats, excluded.confirm_by,
         excluded.reserved_at, excluded.confirmed_at, excluded.handed_over_at, excluded.cancelled_at,
         excluded.no_show_at);
end;
$$;

comment on function public.giving_handoff_upsert_from_post_handoff(public.post_handoffs) is
  'G1 step 3a: derives the giving_handoffs row of a post handoff (same id); compares before writing.';

revoke all on function public.giving_handoff_upsert_from_post_handoff(public.post_handoffs) from public, anon, authenticated;
grant execute on function public.giving_handoff_upsert_from_post_handoff(public.post_handoffs) to service_role;

-- Errors are not swallowed here on purpose: a refusal raised on the derived row (the hourly cap,
-- a constraint) must roll the handoff back, as it did when the RPCs wrote giving_handoffs.
create or replace function public.post_handoffs_giving_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.giving_handoffs where handoff_id = old.handoff_id;
    return old;
  end if;
  perform public.giving_handoff_upsert_from_post_handoff(new);
  return new;
end;
$$;

revoke all on function public.post_handoffs_giving_sync() from public, anon, authenticated;

drop trigger if exists post_handoffs_giving_sync on public.post_handoffs;
create trigger post_handoffs_giving_sync
  after insert or update or delete on public.post_handoffs
  for each row execute function public.post_handoffs_giving_sync();

-- ── The handoff write cap (0534) moves with the record ────────────────────────────────────────
-- trg_write_rate_limit skips nested trigger depth, so the derived giving_handoffs insert is never
-- counted; the cap must sit on the table the RPCs write. Same rule code, same bucket key, so a
-- legacy insert on giving_handoffs and a record insert on post_handoffs draw on one hourly budget.

create or replace function public.trg_write_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims text := coalesce(current_setting('request.jwt.claims', true), '');
  v_role text;
  v_actor uuid;
  v_max int;
begin
  if v_claims = '' or pg_trigger_depth() > 1 then
    return new;
  end if;

  begin
    v_role := v_claims::jsonb ->> 'role';
  exception when others then
    v_role := null;
  end;
  if coalesce(v_role, 'authenticated') not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_table_name = 'listings' then
    v_actor := new.owner_id;
  elsif tg_table_name in ('giving_handoffs', 'post_handoffs') then
    -- Both handoff tables share one bucket (tg_argv[1]); the derived write of either side runs
    -- at trigger depth 2 and is skipped above, so a handoff is counted once.
    v_actor := new.recipient_id;
  elsif tg_table_name = 'follow_edges' then
    v_actor := new.follower_id;
  end if;
  if v_actor is null then
    return new;
  end if;

  select (p.param_value #>> '{}')::int into v_max
    from public.marketplace_rule_params p
   where p.rule_code = tg_argv[0]
     and p.param_key = 'max_per_hour';
  if v_max is null or v_max < 1 then
    raise exception 'invalid_rate_limit_args' using errcode = '22023';
  end if;

  perform public.enforce_rate_limit(tg_argv[1] || ':' || v_actor::text, v_max, 3600);
  return new;
end;
$$;

drop trigger if exists post_handoffs_rate_limit on public.post_handoffs;
create trigger post_handoffs_rate_limit before insert on public.post_handoffs
  for each row execute function public.trg_write_rate_limit('R-SEC-Handoff-Write', 'giving_handoffs');

-- ── Items: reserve → confirm → hand over (0382, 0532) ─────────────────────────────────────────

create or replace function public.reserve_item_giving(
  p_listing_id uuid,
  p_pickup_mode text default 'pickup',
  p_pickup_window_start timestamptz default null,
  p_pickup_window_end timestamptz default null
)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid := public.handoff_target_post_id(p_listing_id);
  v_l public.listings%rowtype;
  v_handoff_id uuid;
  v_row public.giving_handoffs;
  v_mode text;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;

  -- The item's rules (world, direction, status, visibility) still live on the derived listing;
  -- its row lock serialises attempts on the same item before the live-handoff check.
  select l.* into v_l
    from public.listings l
   where l.listing_id = public.listing_id_of_post(v_post_id)
     and l.world_slug = 'items'
     and l.direction = 'give'
     and l.status = 'open'
     and public.is_listing_visible_to(l, v_uid)
   for update;
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  if v_l.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if;
  if exists (
    select 1 from public.post_handoffs h
     where h.post_id = v_post_id
       and h.status in ('reserved', 'confirmed')
       and h.world_slug in ('items', 'food')
  ) then
    raise exception 'item_already_reserved' using errcode = '23514';
  end if;

  v_mode := coalesce(nullif(trim(p_pickup_mode), ''), 'pickup');
  if v_mode not in ('pickup', 'delivery') then
    raise exception 'invalid_pickup_mode' using errcode = '23514';
  end if;

  begin
    insert into public.post_handoffs (
      post_id, owner_id, recipient_id, world_slug, status,
      pickup_mode, pickup_window_start, pickup_window_end, confirm_by
    ) values (
      v_post_id, v_l.owner_id, v_uid, 'items', 'reserved',
      v_mode,
      coalesce(p_pickup_window_start, (v_l.details->>'pickup_window_start')::timestamptz),
      coalesce(p_pickup_window_end, (v_l.details->>'pickup_window_end')::timestamptz),
      now() + interval '24 hours'
    )
    returning handoff_id into v_handoff_id;
  exception when unique_violation then
    raise exception 'item_already_reserved' using errcode = '23514';
  end;

  update public.listings
     set availability_status = 'scheduled', updated_at = now()
   where listing_id = v_l.listing_id;

  -- The app reads the derived row (listing_id included) until the one detail screen lands.
  select * into v_row from public.giving_handoffs where handoff_id = v_handoff_id;
  return v_row;
end;
$$;

revoke all on function public.reserve_item_giving(uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.reserve_item_giving(uuid, text, timestamptz, timestamptz) to authenticated;

create or replace function public.confirm_item_handoff(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.giving_handoffs;
begin
  update public.post_handoffs
     set status = 'confirmed', confirmed_at = now()
   where handoff_id = p_handoff_id
     and owner_id = auth.uid()
     and status = 'reserved'
     and world_slug = 'items';
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  select * into v_row from public.giving_handoffs where handoff_id = p_handoff_id;
  return v_row;
end;
$$;

revoke all on function public.confirm_item_handoff(uuid) from public, anon;
grant execute on function public.confirm_item_handoff(uuid) to authenticated;

create or replace function public.mark_giving_handed_over(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_h public.post_handoffs;
  v_row public.giving_handoffs;
begin
  update public.post_handoffs
     set status = 'handed_over', handed_over_at = now()
   where handoff_id = p_handoff_id
     and status = 'confirmed'
     and (owner_id = auth.uid() or recipient_id = auth.uid())
  returning * into v_h;
  if not found then raise exception 'handoff_not_confirmed' using errcode = '23514'; end if;

  -- The listing closes as before; for a post-sourced listing the post follows through
  -- post_sync_from_listing (0554). The one closing system on the post itself is step 3c (G34).
  update public.listings
     set status = 'closed', availability_status = 'ongoing', updated_at = now()
   where listing_id = public.listing_id_of_post(v_h.post_id);

  perform public.karma_award_handoff(v_h.owner_id, v_h.recipient_id, v_h.world_slug, p_handoff_id);

  select * into v_row from public.giving_handoffs where handoff_id = p_handoff_id;
  return v_row;
end;
$$;

revoke all on function public.mark_giving_handed_over(uuid) from public, anon;
grant execute on function public.mark_giving_handed_over(uuid) to authenticated;

create or replace function public.cancel_giving_handoff(p_handoff_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_h public.post_handoffs;
begin
  update public.post_handoffs
     set status = 'cancelled', cancelled_at = now()
   where handoff_id = p_handoff_id
     and status in ('reserved', 'confirmed')
     and (owner_id = auth.uid() or recipient_id = auth.uid())
  returning * into v_h;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;

  if v_h.world_slug in ('items', 'food') then
    update public.listings
       set availability_status = 'immediate', updated_at = now()
     where listing_id = public.listing_id_of_post(v_h.post_id) and status = 'open';
  end if;
end;
$$;

revoke all on function public.cancel_giving_handoff(uuid) from public, anon;
grant execute on function public.cancel_giving_handoff(uuid) to authenticated;

-- ── Food: quick claim (0383, 0544) ────────────────────────────────────────────────────────────

create or replace function public.claim_food_giving(
  p_listing_id uuid,
  p_pickup_window_start timestamptz default null,
  p_pickup_window_end timestamptz default null
)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid := public.handoff_target_post_id(p_listing_id);
  v_l public.listings%rowtype;
  v_handoff_id uuid;
  v_row public.giving_handoffs;
  v_start timestamptz;
  v_end timestamptz;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_l from public.listings
   where listing_id = public.listing_id_of_post(v_post_id)
     and world_slug = 'food'
     and direction = 'give'
     and status = 'open'
     and (expires_at is null or expires_at > now());
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  if v_l.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if;
  -- A claim goes through the listing's visibility rule, as reserve_item_giving does
  -- (FR-MOD-009 AC1); the refusal is the same as for a missing listing.
  if not public.is_listing_visible_to(v_l, v_uid) then
    raise exception 'listing_not_available' using errcode = 'P0002';
  end if;

  v_start := coalesce(p_pickup_window_start, (v_l.details->>'pickup_window_start')::timestamptz, now());
  v_end := coalesce(
    p_pickup_window_end,
    (v_l.details->>'pickup_window_end')::timestamptz,
    coalesce(v_l.expires_at, now() + interval '4 hours')
  );

  -- One live claim per offer (post_handoffs_active_post_uidx). The app mapped the old index name
  -- to listing_not_available (@kc/domain mapMarketplaceServerError); the RPC now says so itself.
  begin
    insert into public.post_handoffs (
      post_id, owner_id, recipient_id, world_slug, status,
      pickup_mode, pickup_window_start, pickup_window_end, confirmed_at
    ) values (
      v_post_id, v_l.owner_id, v_uid, 'food', 'confirmed',
      'pickup', v_start, v_end, now()
    )
    returning handoff_id into v_handoff_id;
  exception when unique_violation then
    raise exception 'listing_not_available' using errcode = 'P0002';
  end;

  update public.listings
     set availability_status = 'scheduled', urgency_level = public.food_listing_urgency_level(v_l.expires_at),
         updated_at = now()
   where listing_id = v_l.listing_id;

  select * into v_row from public.giving_handoffs where handoff_id = v_handoff_id;
  return v_row;
end;
$$;

revoke all on function public.claim_food_giving(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.claim_food_giving(uuid, timestamptz, timestamptz) to authenticated;

-- ── Sweeps (0386, 0467) ───────────────────────────────────────────────────────────────────────

create or replace function public.giving_handoff_no_show_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    select handoff_id, post_id
      from public.post_handoffs
     where status = 'confirmed'
       and pickup_window_end is not null
       and pickup_window_end < now() - interval '2 hours'
  loop
    update public.post_handoffs
       set status = 'no_show', no_show_at = now()
     where handoff_id = r.handoff_id;
    update public.listings
       set availability_status = 'immediate', updated_at = now()
     where listing_id = public.listing_id_of_post(r.post_id) and status = 'open';
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.giving_handoff_no_show_sweep() from public, anon, authenticated;
grant execute on function public.giving_handoff_no_show_sweep() to service_role;

create or replace function public.food_expired_listings_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    select listing_id, owner_id, title from public.listings
     where world_slug = 'food'
       and status = 'open'
       and expires_at is not null
       and expires_at <= now()
  loop
    update public.post_handoffs
       set status = 'cancelled', cancelled_at = now()
     where post_id = public.post_id_of_listing(r.listing_id) and status in ('reserved', 'confirmed');
    -- A listing the report still lists without a post keeps its handoffs on the legacy side only.
    update public.giving_handoffs
       set status = 'cancelled', cancelled_at = now()
     where listing_id = r.listing_id and status in ('reserved', 'confirmed');
    update public.listings
       set status = 'expired', updated_at = now()
     where listing_id = r.listing_id;
    perform public.enqueue_notification(
      r.owner_id, 'critical', 'listing_expired',
      'notifications.foodExpiredTitle', 'notifications.foodExpiredBody',
      jsonb_build_object('listingTitle', coalesce(r.title, '')),
      jsonb_build_object('route', '/(tabs)/donations/marketplace/[listingId]',
                         'params', jsonb_build_object('listingId', r.listing_id::text)),
      'food_expired:' || r.listing_id::text,
      false
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.food_expired_listings_sweep() from public, anon, authenticated;
grant execute on function public.food_expired_listings_sweep() to service_role;

commit;
