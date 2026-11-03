-- 0544_block_filtering_both_ways | FR-MOD-009 AC1 / AC3 (user blocking in the launch scope,
-- PM decision 2026-11-03): when either member of a pair has blocked the other, the two never
-- see or reach each other, on every surface, in both directions, at the data layer.
-- Surfaces that already used the bilateral public.is_blocked (feeds, listings, search, profile
-- listings, follow, item reservation, ride and knowledge booking, comment / reaction insert)
-- are unchanged. This file applies the same rule to:
--   1. chats: hidden from both members (is_chat_visible_to); no new chat between a blocked
--      pair (chats_insert_self);
--   2. messages: neither side can send (messages_insert_user);
--   3. profile rows reached through an existing chat (users_select_chat_counterpart);
--   4. food claims check the listing's visibility, as item reservations do;
--   5. the closure recipient picker refuses a blocked pair;
--   6. comments and reactions by the other member of a blocked pair are not shown;
--   7. notifications caused by one member are not delivered to the other (enqueue_notification),
--      except the ones that bypass preferences (account and safety notices).
-- Policies use (select auth.uid()) so the uid is evaluated once per query (initplan).

begin;

-- ── 1. chats ─────────────────────────────────────────────────────────────────
create or replace function public.is_chat_visible_to(p_chat public.chats, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_viewer is null then false
    when p_viewer is distinct from p_chat.participant_a
     and p_viewer is distinct from p_chat.participant_b then false
    when p_chat.removed_at is not null then false
    -- A block in either direction hides the chat from both members (FR-MOD-009 AC3).
    when public.is_blocked(
      p_viewer,
      case
        when p_viewer = p_chat.participant_a then p_chat.participant_b
        else p_chat.participant_a
      end
    ) then false
    else true
  end;
$$;

drop policy if exists chats_insert_self on public.chats;
create policy chats_insert_self on public.chats
  for insert
  with check (
    (select auth.uid()) in (participant_a, participant_b)
    and public.is_active_member((select auth.uid()))
    and not public.is_blocked(participant_a, participant_b)
  );

-- ── 2. messages ──────────────────────────────────────────────────────────────
drop policy if exists messages_insert_user on public.messages;
create policy messages_insert_user on public.messages
  for insert to authenticated
  with check (
    (select auth.uid()) = sender_id
    and kind = 'user'
    and system_payload is null
    and status = 'pending'
    and exists (
      select 1 from public.chats c
       where c.chat_id = messages.chat_id
         and c.removed_at is null
         and ((select auth.uid()) = c.participant_a or (select auth.uid()) = c.participant_b)
         -- A block in either direction closes the chat to both members (FR-MOD-009 AC3).
         and not public.is_blocked(c.participant_a, c.participant_b)
         and (public.is_active_member((select auth.uid()))
              or (c.is_support_thread and public.can_contact_support((select auth.uid()))))
    )
  );

-- ── 3. profile rows through a chat ───────────────────────────────────────────
drop policy if exists users_select_chat_counterpart on public.users;
create policy users_select_chat_counterpart on public.users
  for select
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) <> user_id
    and account_status in ('active', 'pending_verification')
    and not public.is_blocked((select auth.uid()), user_id)
    and exists (
      select 1
      from public.chats c
      where (c.participant_a = (select auth.uid()) and c.participant_b = users.user_id)
         or (c.participant_b = (select auth.uid()) and c.participant_a = users.user_id)
    )
  );

-- ── 4. food claims ───────────────────────────────────────────────────────────
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
  v_l public.listings%rowtype;
  v_row public.giving_handoffs;
  v_start timestamptz;
  v_end timestamptz;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_l from public.listings
   where listing_id = p_listing_id
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

  insert into public.giving_handoffs (
    listing_id, owner_id, recipient_id, world_slug, status,
    pickup_mode, pickup_window_start, pickup_window_end, confirmed_at
  ) values (
    p_listing_id, v_l.owner_id, v_uid, 'food', 'confirmed',
    'pickup', v_start, v_end, now()
  )
  returning * into v_row;

  update public.listings
     set availability_status = 'scheduled', urgency_level = public.food_listing_urgency_level(v_l.expires_at),
         updated_at = now()
   where listing_id = p_listing_id;

  return v_row;
end;
$$;

-- ── 5. closure recipient ─────────────────────────────────────────────────────
create or replace function public.close_post_with_recipient(p_post_id uuid, p_recipient_user_id uuid)
returns public.posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner   uuid;
  v_status  text;
  v_post    public.posts;
  v_user_ok boolean;
begin
  select owner_id, status into v_owner, v_status
    from public.posts
   where post_id = p_post_id
   for update;

  if v_owner is null then
    raise exception 'closure_wrong_status' using errcode = 'P0001';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'closure_not_owner' using errcode = 'P0001';
  end if;
  if not public.is_active_member(auth.uid()) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;
  if v_status <> 'open' then
    raise exception 'closure_wrong_status' using errcode = 'P0001';
  end if;

  if v_owner = p_recipient_user_id then
    raise exception 'closure_recipient_not_in_chat' using errcode = 'P0001';
  end if;

  select exists (select 1 from public.users where user_id = p_recipient_user_id)
    into v_user_ok;
  if not v_user_ok then
    raise exception 'closure_recipient_not_in_chat' using errcode = 'P0001';
  end if;
  -- A blocked pair never reaches each other (FR-MOD-009): their chat is hidden from both,
  -- so the recipient is refused like one outside the owner's chats.
  if public.is_blocked(v_owner, p_recipient_user_id) then
    raise exception 'closure_recipient_not_in_chat' using errcode = 'P0001';
  end if;

  insert into public.recipients (post_id, recipient_user_id)
       values (p_post_id, p_recipient_user_id);

  update public.posts
     set status = 'closed_delivered',
         delete_after = null,
         updated_at = now()
   where post_id = p_post_id
   returning * into v_post;

  return v_post;
end;
$$;

-- ── 6. comments and reactions ────────────────────────────────────────────────
drop policy if exists post_reactions_select_visible on public.post_reactions;
create policy post_reactions_select_visible on public.post_reactions
  for select using (
    public.is_post_engagement_visible(post_id, (select auth.uid()))
    and not public.is_blocked((select auth.uid()), user_id)
  );

drop policy if exists post_comments_select_visible on public.post_comments;
create policy post_comments_select_visible on public.post_comments
  for select using (
    status = 'active'
    and public.is_post_engagement_visible(post_id, (select auth.uid()))
    and not public.is_blocked((select auth.uid()), author_id)
  );

-- ── 7. notifications ─────────────────────────────────────────────────────────
create or replace function public.enqueue_notification(
  p_user_id            uuid,
  p_category           text,
  p_kind               text,
  p_title_key          text,
  p_body_key           text,
  p_body_args          jsonb default '{}'::jsonb,
  p_data               jsonb default '{}'::jsonb,
  p_dedupe_key         text default null,
  p_bypass_preferences boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if p_user_id is null then return null; end if;
  -- Self-suppression: never notify the actor of their own action.
  if p_user_id = coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) then
    return null;
  end if;
  -- FR-MOD-009: an action by one member of a blocked pair never notifies the other (mentions,
  -- comments, reactions, follows, handoffs). Notices that bypass preferences still arrive.
  if not p_bypass_preferences and public.is_blocked(p_user_id, auth.uid()) then
    return null;
  end if;
  insert into public.notifications_outbox(
    user_id, category, kind, title_key, body_key, body_args, data, dedupe_key, bypass_preferences
  )
  values (p_user_id, p_category, p_kind, p_title_key, p_body_key, p_body_args, p_data, p_dedupe_key, p_bypass_preferences)
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning notification_id into v_id;
  return v_id;
end $$;

commit;
