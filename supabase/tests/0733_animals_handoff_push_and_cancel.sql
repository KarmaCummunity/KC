-- supabase/tests/0733_animals_handoff_push_and_cancel.sql
-- An adoption request pushes like an item request (FR-NOTIF-018), and a declined or cancelled one
-- frees the post; an event registration is not cancelled through the generic handoff cancel.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('anim_giver')   as giver,
       kc_test.create_user('anim_adopter') as adopter,
       gen_random_uuid()                   as org_id;

insert into public.organizations (org_id, name, slug)
select org_id, 'Generic cancel test org', 'generic-cancel-test-org' from personas;
insert into public.org_memberships (org_id, user_id, role)
select org_id, giver, 'org_admin' from personas;

-- Publishing in the animals world needs a verified identity (`worlds.requires_verification`, 0612).
update public.users set account_status = 'active', verified_at = now()
 where user_id in (select giver from personas union all select adopter from personas);

create function pg_temp.adoption_offer(p_owner uuid, p_title text) returns uuid
language plpgsql as $$
declare v_kind uuid;
begin
  perform kc_test.act_as(p_owner);
  select kind_id into v_kind from public.listing_kinds where world_slug = 'animals' and slug = 'adoption_offer';
  return public.create_marketplace_listing(
    p_kind_id => v_kind, p_title => p_title, p_details => '{"species":"cat"}'::jsonb);
end $$;

create function pg_temp.availability(p_listing uuid) returns text
language sql as $$
  select availability_status from public.posts where post_id = public.post_id_of_listing(p_listing)
$$;

do $$
declare
  p personas;
  v_listing uuid;
  v_handoff uuid;
begin
  select * into p from personas;
  v_listing := pg_temp.adoption_offer(p.giver, 'Kitten looking for a home');

  -- The request reaches the giver, and holds the post.
  perform kc_test.act_as(p.adopter);
  v_handoff := (public.reserve_item_giving(v_listing)).handoff_id;
  perform kc_test.assert_eq(
    (select count(*) from public.notifications_outbox
      where user_id = p.giver and kind = 'giving_handoff_requested'),
    1::bigint, 'the giver hears of an adoption request');
  perform kc_test.assert_eq(pg_temp.availability(v_listing), 'scheduled', 'a request holds the post');

  -- The giver declines: the adopter is told and the post is free again.
  perform kc_test.act_as(p.giver);
  perform public.cancel_giving_handoff(v_handoff);
  perform kc_test.assert_eq(
    (select count(*) from public.notifications_outbox
      where user_id = p.adopter and kind = 'giving_handoff_declined'),
    1::bigint, 'the adopter hears of the decline');
  perform kc_test.assert_eq(pg_temp.availability(v_listing), 'immediate', 'a declined request frees the post');

  -- A new request, approved: the adopter is told.
  perform kc_test.act_as(p.adopter);
  v_handoff := (public.reserve_item_giving(v_listing)).handoff_id;
  perform kc_test.act_as(p.giver);
  perform public.confirm_item_handoff(v_handoff);
  perform kc_test.assert_eq(
    (select count(*) from public.notifications_outbox
      where user_id = p.adopter and kind = 'giving_handoff_confirmed'),
    1::bigint, 'the adopter hears of the approval');
end $$;

-- An event registration keeps its own cancel, which promotes the waitlist (0564).
do $$
declare
  p personas;
  v_listing uuid;
  v_reg public.post_handoffs;
begin
  select * into p from personas;
  perform kc_test.act_as(p.giver);
  v_listing := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('time', 'org_event'), p_title => 'garden day',
    p_details => jsonb_build_object(
      'org_id', p.org_id::text, 'registration_policy', 'automatic',
      'starts_at', kc_test.iso_in(interval '2 days'), 'ends_at', kc_test.iso_in(interval '2 days 2 hours')),
    p_city_id => 'tel-aviv');
  perform kc_test.act_as(p.adopter);
  v_reg := public.register_for_event(public.post_id_of_listing(v_listing));
  perform kc_test.assert_raises(
    format('select public.cancel_giving_handoff(%L)', v_reg.handoff_id),
    'event_use_registration_cancel', 'an event registration cancels through its own RPC');
end $$;

rollback;
