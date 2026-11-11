-- supabase/tests/0692_adr004_idempotency_keys.sql
-- ADR-004 §2 (#1999): Idempotency key tests for post creation, handoffs, and messages.

begin;

create temp table personas as
select kc_test.create_user('idemp_owner') as owner,
       kc_test.create_user('idemp_recipient') as recipient;

create function pg_temp.new_item_post(p_owner uuid)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.posts (
    owner_id, title, description, category, type, status,
    location_display_level, city, street, street_number, visibility, world_slug, direction
  ) values (
    p_owner, 'Item post', 'Description', 'Furniture', 'Give', 'open',
    'CityOnly', 'tel-aviv', 'Herzl', '1', 'Public', 'items', 'offer'
  ) returning post_id into v_id;
  return v_id;
end $$;

create function pg_temp.new_food_post(p_owner uuid)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.posts (
    owner_id, title, description, category, type, status,
    location_display_level, city, street, street_number, visibility, world_slug, direction,
    expires_at
  ) values (
    p_owner, 'Food post', 'Description', 'Food', 'Give', 'open',
    'CityOnly', 'tel-aviv', 'Herzl', '1', 'Public', 'food', 'offer',
    now() + interval '2 hours'
  ) returning post_id into v_id;
  return v_id;
end $$;

-- ── 1. reserve_item_giving idempotency ───────────────────────────────────────
do $$
declare
  p personas;
  v_post uuid;
  h1 public.giving_handoffs;
  h2 public.giving_handoffs;
  v_key text := 'handoff:test:item:1';
begin
  select * into p from personas;
  v_post := pg_temp.new_item_post(p.owner);

  perform kc_test.act_as(p.recipient);
  h1 := public.reserve_item_giving(v_post, 'pickup', now(), now() + interval '1 hour', v_key);
  h2 := public.reserve_item_giving(v_post, 'pickup', now(), now() + interval '1 hour', v_key);

  assert h1.handoff_id = h2.handoff_id, 'reserve_item_giving with same key must return identical handoff';
  assert h1.status = 'reserved', 'handoff status must be reserved';
end $$;

-- ── 2. claim_food_giving idempotency ─────────────────────────────────────────
do $$
declare
  p personas;
  v_post uuid;
  h1 public.giving_handoffs;
  h2 public.giving_handoffs;
  v_key text := 'handoff:test:food:1';
begin
  select * into p from personas;
  v_post := pg_temp.new_food_post(p.owner);

  perform kc_test.act_as(p.recipient);
  h1 := public.claim_food_giving(v_post, now(), now() + interval '1 hour', v_key);
  h2 := public.claim_food_giving(v_post, now(), now() + interval '1 hour', v_key);

  assert h1.handoff_id = h2.handoff_id, 'claim_food_giving with same key must return identical handoff';
  assert h1.status = 'confirmed', 'food handoff status must be confirmed';
end $$;

-- ── 3. confirm_item_handoff idempotent re-confirmation ───────────────────────
do $$
declare
  p personas;
  v_post uuid;
  h_res public.giving_handoffs;
  h_conf1 public.giving_handoffs;
  h_conf2 public.giving_handoffs;
begin
  select * into p from personas;
  v_post := pg_temp.new_item_post(p.owner);

  perform kc_test.act_as(p.recipient);
  h_res := public.reserve_item_giving(v_post, 'pickup', now(), now() + interval '1 hour', 'handoff:test:conf:1');

  perform kc_test.act_as(p.owner);
  h_conf1 := public.confirm_item_handoff(h_res.handoff_id);
  h_conf2 := public.confirm_item_handoff(h_res.handoff_id);

  assert h_conf1.handoff_id = h_conf2.handoff_id, 'confirm_item_handoff must return same handoff';
  assert h_conf2.status = 'confirmed', 're-confirmed handoff must be confirmed';
end $$;

-- ── 4. messages client_id uniqueness ─────────────────────────────────────────
do $$
declare
  p personas;
  v_chat uuid;
  v_cid text := 'msg-client-uuid-123';
  v_err boolean := false;
begin
  select * into p from personas;
  insert into public.chats (participant_a, participant_b)
  values (p.owner, p.recipient)
  returning chat_id into v_chat;

  insert into public.messages (chat_id, sender_id, body, client_id)
  values (v_chat, p.owner, 'Hello', v_cid);

  begin
    insert into public.messages (chat_id, sender_id, body, client_id)
    values (v_chat, p.owner, 'Hello duplicate', v_cid);
  exception when unique_violation then
    v_err := true;
  end;

  assert v_err, 'duplicate (chat_id, client_id) must raise unique_violation';
end $$;

rollback;
