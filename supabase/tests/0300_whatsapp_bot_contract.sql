-- supabase/tests/0300_whatsapp_bot_contract.sql | Issues #842-#846

begin;

create or replace function pg_temp.mk_user(p_id uuid, p_handle text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (p_id, p_handle || '@test.local', now(),
          jsonb_build_object('full_name', 'Display ' || p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, display_name = 'Display ' || p_handle,
         account_status = 'active', privacy_mode = 'Public'
   where user_id = p_id;
end $$;

-- #843 idempotent ingest
do $$
declare
  v_r1 uuid;
  v_r2 uuid;
begin
  v_r1 := public.api_whatsapp_ingest_inbound('wamid.test-1', '{"text":"hello"}'::jsonb);
  v_r2 := public.api_whatsapp_ingest_inbound('wamid.test-1', '{"text":"dup"}'::jsonb);
  if v_r1 is null or v_r1 <> v_r2 then
    raise exception 'ASSERT FAILED: whatsapp ingest idempotency';
  end if;
end $$;

-- #844 intake + publish (services world)
do $$
declare
  v_owner uuid := '00000000-0000-0000-0000-000000300001';
  v_rec uuid;
  v_sess uuid;
  v_ext uuid;
  v_listing uuid;
  v_kind uuid;
begin
  perform pg_temp.mk_user(v_owner, 'wa_bot_user');
  v_rec := public.api_whatsapp_ingest_inbound('wamid.intake-1', '{"from":"972501234567"}'::jsonb);
  perform public.api_bot_link_identity('972501234567', v_owner);
  v_sess := public.api_bot_open_session('972501234567', v_rec);

  select kind_id into v_kind from public.listing_kinds
   where world_slug = 'time' and slug = 'volunteer_shift' limit 1;
  if v_kind is null then
    raise exception 'ASSERT FAILED: time volunteer_shift kind missing';
  end if;

  v_ext := public.api_bot_apply_extraction(
    v_sess, 'time', 'volunteer_shift', 'give', 'Dog walking help',
    '{}'::jsonb, 0.92, 'Weekly walks'
  );
  if v_ext is null then
    raise exception 'ASSERT FAILED: extraction id null';
  end if;

  v_listing := public.api_bot_publish_listing(v_sess, v_owner);
  if v_listing is null then
    raise exception 'ASSERT FAILED: listing not published';
  end if;
end $$;

-- #845 consent + rate limit + match response
do $$
declare
  v_a uuid := '00000000-0000-0000-0000-000000300002';
  v_b uuid := '00000000-0000-0000-0000-000000300003';
  v_give uuid;
  v_req uuid;
  v_match uuid;
  v_out uuid;
  v_n int;
  i int;
begin
  perform pg_temp.mk_user(v_a, 'wa_match_a');
  perform pg_temp.mk_user(v_b, 'wa_match_b');
  perform public.api_bot_set_match_consent(v_a, true);
  perform public.api_bot_set_match_consent(v_b, true);
  -- 0306: proactive sends also need a linked WhatsApp identity and an approved template.
  perform public.api_bot_link_identity('972500300002', v_a);
  perform public.api_bot_link_identity('972500300003', v_b);
  update public.whatsapp_message_templates set is_approved = true where template_name = 'match_found_v1';

  insert into public.listings (
    owner_id, world_slug, kind_id, direction, title, origin, moderation_status, published_at, details
  )
  select v_a, 'items', kind_id, 'give', 'WA test give item', 'native', 'published', now(),
         '{"image_url":"https://example.test/wa.jpg"}'::jsonb
    from public.listing_kinds where world_slug = 'items' and slug = 'give_item'
  returning listing_id into v_give;

  insert into public.listings (
    owner_id, world_slug, kind_id, direction, title, origin, moderation_status, published_at, details
  )
  select v_b, 'items', kind_id, 'request', 'WA test need item', 'native', 'published', now(),
         '{"image_url":"https://example.test/wa2.jpg"}'::jsonb
    from public.listing_kinds where world_slug = 'items' and slug = 'request_item'
  returning listing_id into v_req;

  perform public.api_bot_find_matches(v_a, v_give, 5);

  select match_id into v_match from public.listing_matches
   where listing_id = least(v_give, v_req) and candidate_listing_id = greatest(v_give, v_req)
   limit 1;

  if v_match is null then
    raise exception 'ASSERT FAILED: expected listing_match row';
  end if;

  select count(*) into v_n from public.bot_outbound_messages
   where user_id in (v_a, v_b) and template_name = 'match_found_v1';
  if v_n < 2 then
    raise exception 'ASSERT FAILED: expected whatsapp outbox rows for both owners, got %', v_n;
  end if;

  perform public.api_bot_record_match_response(v_match, v_a, 'accept');

  for i in 1..6 loop
    v_out := public.api_whatsapp_queue_outbound(v_a, 'match_found_v1', '{}'::jsonb, 5);
  end loop;

  if not exists (
    select 1 from public.bot_outbound_messages
     where outbound_id = v_out and status = 'skipped_rate_limit'
  ) then
    raise exception 'ASSERT FAILED: rate limit should skip 6th send';
  end if;
end $$;

-- #846 dedupe + admin review list
do $$
declare
  v_n int;
  v_rev uuid;
  v_ext uuid;
begin
  select count(*) into v_n from public.api_bot_find_duplicate_listings('WA test give', 'items', 0.3, 5);
  if v_n < 1 then
    raise exception 'ASSERT FAILED: duplicate search should find similar title';
  end if;

  select extraction_id into v_ext from public.extractions order by created_at desc limit 1;
  v_rev := public.api_bot_admin_review_enqueue(v_ext, 'contract_test');
  select count(*) into v_n from public.api_bot_admin_review_list(10) where review_id = v_rev;
  if v_n <> 1 then
    raise exception 'ASSERT FAILED: admin review list should include enqueued item';
  end if;
end $$;

rollback;

\echo '✓ 0300_whatsapp_bot_contract.sql passed'
