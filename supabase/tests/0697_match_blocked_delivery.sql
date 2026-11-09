-- 0697: cron match delivery must not notify blocked pairs (TD-263 / FR-MOD-009).

begin;

create or replace function pg_temp.mk_user_697(p_id uuid, p_handle text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (p_id, p_handle || '@697.test', now(),
          jsonb_build_object('full_name', p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated')
  on conflict (id) do nothing;
  insert into public.users (user_id, share_handle, display_name, account_status, privacy_mode, onboarding_state)
  values (p_id, p_handle, p_handle, 'active', 'Public', 'completed')
  on conflict (user_id) do update
     set account_status = 'active', privacy_mode = 'Public', onboarding_state = 'completed';
end $$;

do $$
declare
  v_offer uuid;
  v_req uuid;
  v_a uuid := '00000000-0000-0000-0697-0000000000a1';
  v_b uuid := '00000000-0000-0000-0697-0000000000b2';
  v_cand uuid;
  v_res jsonb;
begin
  perform pg_temp.mk_user_697(v_a, 'blk_a');
  perform pg_temp.mk_user_697(v_b, 'blk_b');
  insert into public.blocks (blocker_id, blocked_id) values (v_b, v_a)
  on conflict do nothing;

  insert into public.listings (owner_id, world_slug, kind_id, direction, title, anonymity_level, status, moderation_status, details)
  values (v_a, 'items',
          (select kind_id from public.listing_kinds where world_slug = 'items' and slug = 'give_item' limit 1),
          'give', 'Blocked-pair offer', 3, 'open', 'published', '{}'::jsonb)
  returning listing_id into v_offer;

  insert into public.listings (owner_id, world_slug, kind_id, direction, title, anonymity_level, status, moderation_status, details)
  values (v_b, 'items',
          (select kind_id from public.listing_kinds where world_slug = 'items' and slug = 'request_item' limit 1),
          'request', 'Blocked-pair request', 3, 'open', 'published', '{}'::jsonb)
  returning listing_id into v_req;

  insert into public.match_candidates (
    offer_listing_id, request_listing_id, offer_owner_id, request_owner_id, world_slug,
    score, components, status
  ) values (
    v_offer, v_req, v_a, v_b, 'items', 0.99, '{"text": 0.9}'::jsonb, 'suggested'
  ) returning candidate_id into v_cand;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  v_res := public.match_deliver_pending(50, null);

  if coalesce((v_res ->> 'withdrawn_blocked')::int, 0) < 1
     and not exists (
       select 1 from public.match_candidates
        where candidate_id = v_cand and status = 'withdrawn') then
    raise exception 'ASSERT FAILED: blocked pair should be withdrawn on delivery sweep, got %', v_res;
  end if;

  if exists (
    select 1 from public.notifications_outbox
     where kind = 'match_suggested'
       and dedupe_key like 'match_cand:' || v_cand::text || ':%') then
    raise exception 'ASSERT FAILED: blocked pair must not enqueue match_suggested notifications';
  end if;
end $$;

rollback;
