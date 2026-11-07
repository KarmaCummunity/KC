-- 0390–0399 rides + knowledge worlds smoke checks.

do $$
declare
  v_fn regprocedure;
begin
  if to_regclass('public.giving_handoffs') is null then
    raise exception 'giving_handoffs missing';
  end if;

  -- world_slug check includes rides + knowledge
  if not exists (
    select 1 from pg_constraint c
     join pg_class t on t.oid = c.conrelid
    where t.relname = 'giving_handoffs'
      and c.conname = 'giving_handoffs_world_slug_check'
      and pg_get_constraintdef(c.oid) like '%rides%'
      and pg_get_constraintdef(c.oid) like '%knowledge%'
  ) then
    raise exception 'giving_handoffs world_slug check missing rides/knowledge';
  end if;

  if to_regprocedure('public.find_ride_listing_matches(double precision,double precision,double precision,double precision,timestamptz,timestamptz,double precision,int)') is null then
    raise exception 'find_ride_listing_matches missing';
  end if;
  if to_regprocedure('public.book_ride_seat(uuid,int,jsonb)') is null then
    raise exception 'book_ride_seat missing';
  end if;
  if to_regprocedure('public.complete_ride_trip(uuid)') is null then
    raise exception 'complete_ride_trip missing';
  end if;
  if to_regprocedure('public.book_knowledge_slot(uuid)') is null then
    raise exception 'book_knowledge_slot missing';
  end if;
  if to_regprocedure('public.complete_knowledge_session(uuid)') is null then
    raise exception 'complete_knowledge_session missing';
  end if;

  -- detail schemas updated
  if not exists (
    select 1 from public.listing_kinds
     where world_slug = 'rides' and slug = 'ride_offer'
       and detail_schema::text like '%origin_lat%'
  ) then
    raise exception 'ride_offer detail_schema missing origin_lat';
  end if;
  if not exists (
    select 1 from public.listing_kinds
     where world_slug = 'knowledge' and slug = 'private_lesson'
       and detail_schema::text like '%slot_starts_at%'
  ) then
    raise exception 'private_lesson detail_schema missing slot_starts_at';
  end if;
end $$;

\echo '✓ 0390_rides_knowledge_worlds.sql passed'
