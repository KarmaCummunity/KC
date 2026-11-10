-- supabase/tests/0733_animals_handoff_push_and_cancel.sql
-- An adoption request pushes like an item request (FR-NOTIF-018), and a declined or cancelled one
-- frees the post. Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('anim_giver')   as giver,
       kc_test.create_user('anim_adopter') as adopter;

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

rollback;
