-- 0464_chat_listing_anchor | KC#1297 — a chat started from a listing opens, and keeps the listing
-- as its context.
--
-- `start_listing_chat` (`0322`) created the chat with `ON CONFLICT (participant_a, participant_b)`,
-- but `chats` has no unique constraint on that pair (only `chats_unique_support_pair`, partial),
-- so every first contact from an items / food / donation listing failed with "no unique or
-- exclusion constraint matching the ON CONFLICT specification". It also kept the first anchor,
-- so a second listing never showed up in an existing chat.
--
-- A chat shows one context: the entry point the conversation was last opened from
-- (FR-CHAT-014 AC6). Opening from a listing anchors the listing and clears a post / ride anchor;
-- opening from a post or a ride clears a listing anchor (the ride RPC already cleared the post).
--
--   1. `start_listing_chat` requires an active account (like the other chat RPCs, `0200`),
--      serializes per pair, and reuses the pair's chat the way the app's DM flow does
--      (`findOrCreateDmChat`: the latest non-support chat the caller has not hidden, else the
--      pair's support thread, else a new chat) and anchors it to the listing.
--   2. `rpc_chat_set_anchor` (post) also clears the ride and listing anchors.
--   3. `rpc_chat_set_anchor_ride` also clears the listing anchor.
--
-- Function bodies are the current definitions (`0322`, `0200`, `0122`) with only the marked lines
-- changed. Idempotent.

begin;

-- ── 1. Start (or reuse) a chat from a listing ─────────────────────────────
create or replace function public.start_listing_chat(p_listing_id uuid, p_opening_message text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid     uuid := auth.uid();
  v_listing public.listings;
  v_other   uuid;
  v_chat_id uuid;
  v_a       uuid;
  v_b       uuid;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  -- KC#1297: same gate as the other chat RPCs (0200) — the opener below is written as definer,
  -- so the messages RLS check for an active account would not apply to it.
  if not public.is_active_member(v_uid) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;

  select * into v_listing from public.listings where listing_id = p_listing_id;
  if not found or not public.is_listing_visible_to(v_listing, v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_other := v_listing.owner_id;
  if v_other = v_uid then
    raise exception 'cannot_chat_self' using errcode = '22023';
  end if;

  v_a := least(v_uid, v_other);
  v_b := greatest(v_uid, v_other);

  -- Serialize concurrent first contact for this pair: ordinary chats have no unique pair index,
  -- so two parallel calls could otherwise both miss the lookup below and insert two chats.
  perform pg_advisory_xact_lock(hashtext('chat_pair_' || v_a::text || '_' || v_b::text)::bigint);

  -- KC#1297: same chat choice as the app's DM flow — the most recent ordinary chat of the pair
  -- that the caller has not hidden from their inbox (FR-CHAT-016).
  select c.chat_id into v_chat_id
    from public.chats c
   where c.participant_a = v_a and c.participant_b = v_b
     and not c.is_support_thread
     and (case when v_uid = v_a then c.inbox_hidden_at_a else c.inbox_hidden_at_b end) is null
   order by c.last_message_at desc nulls last, c.created_at desc
   limit 1;

  if v_chat_id is null then
    begin
      insert into public.chats (participant_a, participant_b, anchor_listing_id)
      values (v_a, v_b, p_listing_id)
      returning chat_id into v_chat_id;
    exception when unique_violation then
      -- The pair is a support pair (`chats_unique_support_pair`): reuse that thread.
      select c.chat_id into v_chat_id
        from public.chats c
       where c.participant_a = v_a and c.participant_b = v_b and c.is_support_thread;
    end;
  end if;

  -- KC#1297: the listing becomes the chat's context; a post / ride context gives way to it.
  update public.chats
     set anchor_listing_id = p_listing_id,
         anchor_post_id    = null,
         anchor_ride_id    = null
   where chat_id = v_chat_id
     and (anchor_listing_id is distinct from p_listing_id
          or anchor_post_id is not null
          or anchor_ride_id is not null);

  if p_opening_message is not null and char_length(trim(p_opening_message)) > 0 then
    insert into public.messages (chat_id, sender_id, kind, body, status)
    values (v_chat_id, v_uid, 'user', trim(p_opening_message), 'pending');
  end if;

  return v_chat_id;
end;
$$;

-- ── 2. Post anchor clears the ride and listing anchors ────────────────────
create or replace function public.rpc_chat_set_anchor(p_chat_id uuid, p_anchor_post_id uuid)
returns chats
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.chats;
  v_post public.posts;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;
  if not public.is_active_member(v_uid) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;

  select * into v_row
  from public.chats
  where chat_id = p_chat_id;

  if v_row.chat_id is null then
    raise exception 'chat_not_found' using errcode = 'P0001';
  end if;

  if v_row.participant_a <> v_uid and v_row.participant_b <> v_uid then
    raise exception 'not_participant' using errcode = 'P0001';
  end if;

  select * into v_post
  from public.posts
  where post_id = p_anchor_post_id;

  if v_post.post_id is null then
    raise exception 'post_not_found' using errcode = 'P0001';
  end if;

  if not public.is_post_visible_to(v_post, v_uid) then
    raise exception 'post_not_visible' using errcode = 'P0001';
  end if;

  -- KC#1297: already anchored to this post alone — nothing to change.
  if v_row.anchor_post_id is not distinct from p_anchor_post_id
     and v_row.anchor_ride_id is null
     and v_row.anchor_listing_id is null then
    return v_row;
  end if;

  update public.chats
     set anchor_post_id    = p_anchor_post_id,
         anchor_ride_id    = null,  -- KC#1297: one context per chat
         anchor_listing_id = null
   where chat_id = p_chat_id
  returning * into v_row;

  return v_row;
end;
$$;

-- ── 3. Ride anchor clears the listing anchor ──────────────────────────────
create or replace function public.rpc_chat_set_anchor_ride(p_chat_id uuid, p_anchor_ride_id uuid)
returns chats
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.chats;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;

  select * into v_row
  from public.chats
  where chat_id = p_chat_id;

  if v_row.chat_id is null then
    raise exception 'chat_not_found' using errcode = 'P0001';
  end if;

  if v_row.participant_a <> v_uid and v_row.participant_b <> v_uid then
    raise exception 'not_participant' using errcode = 'P0001';
  end if;

  -- KC#1297: already anchored to this ride alone — nothing to change.
  if v_row.anchor_ride_id is not distinct from p_anchor_ride_id
     and v_row.anchor_post_id is null
     and v_row.anchor_listing_id is null then
    return v_row;
  end if;

  update public.chats
     set anchor_ride_id    = p_anchor_ride_id,
         anchor_post_id    = null,
         anchor_listing_id = null  -- KC#1297: one context per chat
   where chat_id = p_chat_id
  returning * into v_row;

  return v_row;
end;
$$;

commit;
