-- 0434_whatsapp_agent_tools | Issue #1091: read RPCs for the WhatsApp Pro agent's KC tool
-- layer. Search + posting reuse the existing bot contract (api_bot_search_listings,
-- api_bot_open_session / api_bot_apply_extraction / api_bot_publish_listing). All of these
-- are service-role only and always scoped to the linked user passed by the webhook.

-- Cards for search results: only open, published, public listings (or the viewer's own).
create or replace function public.api_bot_listing_cards(p_viewer_id uuid, p_ids uuid[])
returns table (
  listing_id uuid,
  world_slug text,
  direction text,
  title text,
  summary text,
  city_id text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select l.listing_id, l.world_slug, l.direction, l.title, l.summary, l.city_id, l.created_at
    from public.listings l
   where l.listing_id = any(coalesce(p_ids, '{}'))
     and l.status = 'open'
     and l.moderation_status = 'published'
     and (l.visibility = 'Public' or l.owner_id = p_viewer_id)
   order by array_position(p_ids, l.listing_id);
$$;

-- The user's own open listings.
create or replace function public.api_bot_my_listings(p_user_id uuid, p_limit int default 10)
returns table (
  listing_id uuid,
  world_slug text,
  direction text,
  title text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select l.listing_id, l.world_slug, l.direction, l.title, l.created_at
    from public.listings l
   where l.owner_id = p_user_id and l.status = 'open'
   order by l.created_at desc
   limit least(greatest(coalesce(p_limit, 10), 1), 25);
$$;

-- The user's current match suggestions (matching v2), with the other side's public card.
create or replace function public.api_bot_my_matches(p_user_id uuid, p_limit int default 10)
returns table (
  candidate_id uuid,
  world_slug text,
  score numeric,
  status text,
  my_listing_title text,
  other_listing_id uuid,
  other_title text,
  distance_km numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select m.candidate_id, m.world_slug, m.score, m.status,
         mine.title,
         other.listing_id, other.title, m.distance_km
    from public.match_candidates m
    join public.listings mine
      on mine.listing_id = case when m.offer_owner_id = p_user_id
                                then m.offer_listing_id else m.request_listing_id end
    join public.listings other
      on other.listing_id = case when m.offer_owner_id = p_user_id
                                 then m.request_listing_id else m.offer_listing_id end
   where (m.offer_owner_id = p_user_id or m.request_owner_id = p_user_id)
     and m.status in ('suggested', 'accepted')
     and other.status = 'open'
     and other.visibility = 'Public'
   order by m.score desc, m.computed_at desc
   limit least(greatest(coalesce(p_limit, 10), 1), 25);
$$;

revoke all on function public.api_bot_listing_cards(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.api_bot_my_listings(uuid, int) from public, anon, authenticated;
revoke all on function public.api_bot_my_matches(uuid, int) from public, anon, authenticated;
grant execute on function public.api_bot_listing_cards(uuid, uuid[]) to service_role;
grant execute on function public.api_bot_my_listings(uuid, int) to service_role;
grant execute on function public.api_bot_my_matches(uuid, int) to service_role;
