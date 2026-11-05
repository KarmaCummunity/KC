-- 0636_g1_match_delivery_on_posts | G1 step 6a-6d (ADR-006, D-214, issue #1671): the match readers
-- read the record of a post-owned listing.
--
-- Of the delivery and reader functions of matching v2, two take something from listings that the
-- post owns (listing_record_of, 0635):
--   1. rpc_my_matches (0422)  hides a suggested pair whose listings are no longer open, on their
--      record (the post's status in the listing's words; the listing's own during a moderation
--      hold), and checks the other listing's visibility on its post (post_listing_visible_to, 0628)
--      when it is post-owned
--   2. api_bot_my_matches (0434)  keeps the other listing when its record is open
-- The others read only what stays the listing's — titles and summaries (the 0554 backfill, 0630),
-- creation times, ids and owners — so their bodies are unchanged: match_deliver_pending (0460),
-- rpc_match_respond (0422) and api_match_llm_pending (0423).
-- Output is the same while post and listing are in step, which the test proves with the pre-0636
-- bodies as oracles. Bodies are the latest definitions copied verbatim; changed lines carry
-- `-- 0636`. Names, arguments, return shapes and grants are unchanged.

begin;

-- ── 1. rpc_my_matches (0422) ────────────────────────────────────────────────────────────────────
create or replace function public.rpc_my_matches(p_limit integer default 20)
returns table (
  candidate_id        uuid,
  status              text,
  score               numeric,
  components          jsonb,
  distance_km         numeric,
  world_slug          text,
  my_role             text,
  my_listing_id       uuid,
  my_listing_title    text,
  other_listing_id    uuid,
  other_listing_title text,
  other_listing_summary text,
  other_owner_id      uuid,
  other_owner_name    text,
  other_owner_avatar  text,
  other_owner_handle  text,
  my_response         text,
  other_response      text,
  llm_reason          text,
  created_at          timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  mine as (
    select m.*,
           case when m.offer_owner_id = me.uid then 'offer' else 'request' end as role
      from public.match_candidates m, me
     where me.uid is not null
       and m.status in ('suggested', 'accepted')
       and (m.offer_owner_id = me.uid or m.request_owner_id = me.uid)
  )
  select x.candidate_id,
         x.status,
         public.match_effective_score(x.score, x.llm_score),
         x.components,
         x.distance_km,
         x.world_slug,
         x.role,
         own.listing_id,
         own.title,
         oth.listing_id,
         oth.title,
         oth.summary,
         u.user_id,
         u.display_name,
         u.avatar_url,
         u.share_handle,
         case when x.role = 'offer' then x.offer_response else x.request_response end,
         case when x.role = 'offer' then x.request_response else x.offer_response end,
         case when (select s.llm_rerank_enabled from public.matching_settings s where s.id) then x.llm_reason end,
         x.created_at
    from mine x
    cross join me
    join public.listings own on own.listing_id = case when x.role = 'offer' then x.offer_listing_id else x.request_listing_id end
    join public.listings oth on oth.listing_id = case when x.role = 'offer' then x.request_listing_id else x.offer_listing_id end
    join public.users u on u.user_id = oth.owner_id
    -- 0636: each listing's record (listing_record_of, 0635): the post's status for a post-owned one.
    cross join lateral public.listing_record_of(own) own_rec                               -- 0636
    cross join lateral public.listing_record_of(oth) oth_rec                               -- 0636
    left join public.posts oth_post on oth_post.post_id = oth.legacy_post_id and oth.origin = 'native' -- 0636
   where (case when x.role = 'offer' then x.offer_response else x.request_response end) is distinct from 'declined'
     and (x.status = 'accepted' or (own_rec.status = 'open' and oth_rec.status = 'open'))    -- 0636
     and (case when oth_post.post_id is null then public.is_listing_visible_to(oth, me.uid)  -- 0636
               else public.post_listing_visible_to(oth_post, me.uid) end)                  -- 0636: the post's visibility
   order by (x.status = 'accepted') desc, public.match_effective_score(x.score, x.llm_score) desc, x.computed_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

revoke all on function public.rpc_my_matches(integer) from public, anon;
grant execute on function public.rpc_my_matches(integer) to authenticated;

-- ── 2. api_bot_my_matches (0434) ────────────────────────────────────────────────────────────────
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
    -- 0636: the other listing's record (listing_record_of, 0635): the post's status for a post-owned one.
    cross join lateral public.listing_record_of(other) other_rec                          -- 0636
   where (m.offer_owner_id = p_user_id or m.request_owner_id = p_user_id)
     and m.status in ('suggested', 'accepted')
     and other_rec.status = 'open'                                                         -- 0636
     and other.visibility = 'Public'
   order by m.score desc, m.computed_at desc
   limit least(greatest(coalesce(p_limit, 10), 1), 25);
$$;

revoke all on function public.api_bot_my_matches(uuid, int) from public, anon, authenticated;
grant execute on function public.api_bot_my_matches(uuid, int) to service_role;

commit;
