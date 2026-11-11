-- 0692_adr004_idempotency_keys.sql
-- ADR-004 §2: Idempotency keys per entity (#1999)
-- 1. Adds idempotency_key to public.post_handoffs
-- 2. Adds client_id to public.messages
-- 3. Updates reserve_item_giving and claim_food_giving with p_idempotency_key
-- 4. Updates confirm_item_handoff for idempotent re-confirmation

begin;

-- ── 1. post_handoffs idempotency key ─────────────────────────────────────────
alter table public.post_handoffs
  add column if not exists idempotency_key text;

create unique index if not exists post_handoffs_idempotency_key_uidx
  on public.post_handoffs (idempotency_key)
  where idempotency_key is not null;

-- ── 2. messages client_id for deduplication ──────────────────────────────────
alter table public.messages
  add column if not exists client_id text;

create unique index if not exists messages_chat_client_id_uidx
  on public.messages (chat_id, client_id)
  where client_id is not null;

-- ── 3. reserve_item_giving with p_idempotency_key ───────────────────────────
drop function if exists public.reserve_item_giving(uuid, text, timestamptz, timestamptz);

create or replace function public.reserve_item_giving(
  p_listing_id uuid,
  p_pickup_mode text default 'pickup',
  p_pickup_window_start timestamptz default null,
  p_pickup_window_end timestamptz default null,
  p_idempotency_key text default null
)
returns public.giving_handoffs
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid := public.handoff_target_post_id(p_listing_id);
  v_post public.posts;
  v_handoff_id uuid;
  v_row public.giving_handoffs;
  v_mode text;
  v_lid uuid;
  v_existing_id uuid;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;

  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    select handoff_id into v_existing_id
      from public.post_handoffs
     where idempotency_key = p_idempotency_key;
    if v_existing_id is not null then
      return public.giving_handoff_row_of(v_existing_id);
    end if;
  end if;

  select p.* into v_post
    from public.posts p
   where p.post_id = v_post_id
     and p.direction = 'offer'
     and p.status = 'open'
     and (
       p.world_slug = 'items'
       or (
         p.world_slug = 'animals'
         and exists (
           select 1 from public.listing_kinds k
            where k.kind_id = p.kind_id
              and k.slug in ('adoption_offer', 'foster_offer')
         )
       )
     )
   for update;
  if not found or not public.is_post_visible_to(v_post, v_uid) then
    raise exception 'listing_not_available' using errcode = 'P0002';
  end if;
  if v_post.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if;
  if exists (
    select 1 from public.post_handoffs h
     where h.post_id = v_post_id
       and h.status in ('reserved', 'confirmed')
       and h.world_slug in ('items', 'food', 'animals')
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
      pickup_mode, pickup_window_start, pickup_window_end, confirm_by,
      idempotency_key
    ) values (
      v_post_id, v_post.owner_id, v_uid, v_post.world_slug, 'reserved',
      v_mode,
      coalesce(p_pickup_window_start, (v_post.details->>'pickup_window_start')::timestamptz),
      coalesce(p_pickup_window_end, (v_post.details->>'pickup_window_end')::timestamptz),
      now() + interval '24 hours',
      nullif(trim(p_idempotency_key), '')
    )
    returning handoff_id into v_handoff_id;
  exception when unique_violation then
    if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
      select handoff_id into v_existing_id
        from public.post_handoffs
       where idempotency_key = p_idempotency_key;
      if v_existing_id is not null then
        return public.giving_handoff_row_of(v_existing_id);
      end if;
    end if;
    raise exception 'item_already_reserved' using errcode = '23514';
  end;

  update public.posts
     set availability_status = 'scheduled', updated_at = now()
   where post_id = v_post_id;

  v_lid := coalesce(v_post.legacy_listing_id, public.listing_id_of_post(v_post_id));
  if v_lid is not null then
    update public.listings
       set availability_status = 'scheduled', updated_at = now()
     where listing_id = v_lid;
  end if;

  v_row := public.giving_handoff_row_of(v_handoff_id);
  return v_row;
end;
$$;

grant execute on function public.reserve_item_giving(uuid, text, timestamptz, timestamptz, text) to authenticated, service_role;

-- ── 4. claim_food_giving with p_idempotency_key ─────────────────────────────
drop function if exists public.claim_food_giving(uuid, timestamptz, timestamptz);

create or replace function public.claim_food_giving(
  p_listing_id uuid,
  p_pickup_window_start timestamptz default null,
  p_pickup_window_end timestamptz default null,
  p_idempotency_key text default null
)
returns public.giving_handoffs
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid := public.handoff_target_post_id(p_listing_id);
  v_post public.posts;
  v_handoff_id uuid;
  v_row public.giving_handoffs;
  v_start timestamptz;
  v_end timestamptz;
  v_lid uuid;
  v_existing_id uuid;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;

  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    select handoff_id into v_existing_id
      from public.post_handoffs
     where idempotency_key = p_idempotency_key;
    if v_existing_id is not null then
      return public.giving_handoff_row_of(v_existing_id);
    end if;
  end if;

  select * into v_post from public.posts
   where post_id = v_post_id
     and world_slug = 'food'
     and direction = 'offer'
     and status = 'open'
     and (expires_at is null or expires_at > now())
   for update;
  if not found or not public.is_post_visible_to(v_post, v_uid) then
    raise exception 'listing_not_available' using errcode = 'P0002';
  end if;
  if v_post.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if;

  v_start := coalesce(p_pickup_window_start, (v_post.details->>'pickup_window_start')::timestamptz, now());
  v_end := coalesce(
    p_pickup_window_end,
    (v_post.details->>'pickup_window_end')::timestamptz,
    coalesce(v_post.expires_at, now() + interval '4 hours')
  );

  begin
    insert into public.post_handoffs (
      post_id, owner_id, recipient_id, world_slug, status,
      pickup_mode, pickup_window_start, pickup_window_end, confirmed_at,
      idempotency_key
    ) values (
      v_post_id, v_post.owner_id, v_uid, 'food', 'confirmed',
      'pickup', v_start, v_end, now(),
      nullif(trim(p_idempotency_key), '')
    )
    returning handoff_id into v_handoff_id;
  exception when unique_violation then
    if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
      select handoff_id into v_existing_id
        from public.post_handoffs
       where idempotency_key = p_idempotency_key;
      if v_existing_id is not null then
        return public.giving_handoff_row_of(v_existing_id);
      end if;
    end if;
    raise exception 'listing_not_available' using errcode = 'P0002';
  end;

  update public.posts
     set availability_status = 'scheduled',
         urgency_level = public.food_listing_urgency_level(v_post.expires_at),
         updated_at = now()
   where post_id = v_post_id;

  v_lid := coalesce(v_post.legacy_listing_id, public.listing_id_of_post(v_post_id));
  if v_lid is not null then
    update public.listings
       set availability_status = 'scheduled',
           urgency_level = public.food_listing_urgency_level(v_post.expires_at),
           updated_at = now()
     where listing_id = v_lid;
  end if;

  v_row := public.giving_handoff_row_of(v_handoff_id);
  return v_row;
end;
$$;

grant execute on function public.claim_food_giving(uuid, timestamptz, timestamptz, text) to authenticated, service_role;

-- ── 5. confirm_item_handoff idempotent re-confirmation ──────────────────────
create or replace function public.confirm_item_handoff(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.giving_handoffs;
begin
  update public.post_handoffs
     set status = 'confirmed', confirmed_at = coalesce(confirmed_at, now())
   where handoff_id = p_handoff_id
     and owner_id = auth.uid()
     and status in ('reserved', 'confirmed')
     and world_slug in ('items', 'animals');
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  v_row := public.giving_handoff_row_of(p_handoff_id);
  return v_row;
end;
$$;

grant execute on function public.confirm_item_handoff(uuid) to authenticated, service_role;

commit;
