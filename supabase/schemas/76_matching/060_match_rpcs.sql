-- Matching · member RPCs: my matches, answering, similar posts, recommendations
--
-- The lists run with the caller's rights and return post cards, so RLS on `posts` decides
-- what comes back. Pairs and embeddings are not readable by a member, and a nearest-vector
-- search cannot run under RLS as an index scan (30_social/075), so three helpers in
-- `kc_access` resolve ids with definer rights; the caller then re-reads the posts under
-- RLS. A device cannot address `kc_access`, so unfiltered ids never leave the database.

-- The caller's live pairs: the ones they did not decline, mutual accepts first, then by
-- score. At most 50.
create function kc_access.my_match_rows(p_limit integer)
returns table (
  match_id uuid, status text, score numeric, distance_km numeric, world_slug text, my_role text,
  my_post_id uuid, other_post_id uuid, my_response text, other_response text, llm_reason text,
  created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.status, kc_private.match_effective_score(m.score, m.llm_score), m.distance_km,
         m.world_slug, s.my_role,
         case s.my_role when 'offer' then m.offer_post_id else m.request_post_id end,
         case s.my_role when 'offer' then m.request_post_id else m.offer_post_id end,
         case s.my_role when 'offer' then m.offer_response else m.request_response end,
         case s.my_role when 'offer' then m.request_response else m.offer_response end,
         m.llm_reason, m.created_at
    from kc_private.match_candidates m
   cross join lateral (
     select case when m.offer_owner_id = (select auth.uid()) then 'offer' else 'request' end as my_role) s
   where m.status in ('suggested', 'accepted')
     and (m.offer_owner_id = (select auth.uid()) or m.request_owner_id = (select auth.uid()))
   order by (m.status = 'accepted') desc, 3 desc, m.id
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;
comment on function kc_access.my_match_rows(integer) is
  'The caller''s own matching pairs. The caller re-reads the posts under RLS.';
grant execute on function kc_access.my_match_rows(integer) to authenticated;

-- The caller's matches with the other member's post as a card. A pair whose other post
-- the caller can no longer read (closed, hidden, blocked) is left out; a pair both accepted
-- stays as long as the post is readable.
create function public.my_matches(p_limit integer default 20)
returns table (
  match_id uuid, status text, score numeric, distance_km numeric, world_slug text, my_role text,
  my_post_id uuid, my_post_title text, my_response text, other_response text, llm_reason text,
  created_at timestamptz, other_post public.post_card)
language sql
stable
security invoker
set search_path = ''
as $$
  with mine as materialized (select r.* from kc_access.my_match_rows(p_limit) r)
  select m.match_id, m.status, m.score, m.distance_km, m.world_slug, m.my_role, m.my_post_id, p.title,
         m.my_response, m.other_response, m.llm_reason, m.created_at, c
    from mine m
    join public.posts p on p.id = m.my_post_id
    join public.post_cards((select array_agg(x.other_post_id) from mine x)) c on c.id = m.other_post_id
   where m.status = 'accepted' or (p.status = 'open' and c.status = 'open')
   order by (m.status = 'accepted') desc, m.score desc, m.match_id;
$$;
comment on function public.my_matches(integer) is
  'The caller''s matching pairs, best first, each with the other member''s post as a card.';
grant execute on function public.my_matches(integer) to authenticated;

-- The caller answers a pair. A decline closes it for good and the two owners are not
-- paired again; an accept tells the other owner (`match_interest`), and the second accept
-- makes the pair `accepted` (`match_accepted`). Returns the pair's status.
--   match_not_found   no such pair, or not the caller's
--   match_not_open    the pair is already accepted, declined or expired
create function public.match_respond(p_match_id uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_pair kc_private.match_candidates;
  v_is_offer boolean;
  v_other_id uuid;
  v_status text;
begin
  select m.* into v_pair from kc_private.match_candidates m
   where m.id = p_match_id and v_user_id in (m.offer_owner_id, m.request_owner_id)
     for update;
  if not found then
    raise exception 'match_not_found' using errcode = 'P0001';
  end if;
  if v_pair.status <> 'suggested' or p_accept is null then
    raise exception 'match_not_open' using errcode = 'P0001';
  end if;
  v_is_offer := v_user_id = v_pair.offer_owner_id;
  v_other_id := case when v_is_offer then v_pair.request_owner_id else v_pair.offer_owner_id end;
  v_status := case
    when not p_accept then 'declined'
    when (case when v_is_offer then v_pair.request_response else v_pair.offer_response end) = 'accepted'
      then 'accepted'
    else 'suggested' end;

  perform set_config('kc.fsm_role', 'member', true);
  update kc_private.match_candidates m
     set status = v_status,
         offer_response = case when v_is_offer then
           case when p_accept then 'accepted' else 'declined' end else m.offer_response end,
         offer_responded_at = case when v_is_offer then now() else m.offer_responded_at end,
         request_response = case when v_is_offer then m.request_response else
           case when p_accept then 'accepted' else 'declined' end end,
         request_responded_at = case when v_is_offer then m.request_responded_at else now() end
   where m.id = p_match_id;
  perform set_config('kc.fsm_role', '', true);

  if p_accept then
    perform kc_private.outbox_enqueue('notification', jsonb_build_object(
      'kind', case v_status when 'accepted' then 'match_accepted' else 'match_interest' end,
      'recipient_id', v_other_id, 'actor_id', v_user_id,
      'entity', jsonb_build_object('type', 'match', 'id', p_match_id),
      'data', jsonb_build_object(
        'post_id', case when v_is_offer then v_pair.offer_post_id else v_pair.request_post_id end,
        'dedupe_key', 'match_response:' || p_match_id || ':' || v_user_id)));
  end if;
  return v_status;
end;
$$;
comment on function public.match_respond(uuid, boolean) is
  'The caller accepts or declines one of their matching pairs; returns the pair''s status.';
grant execute on function public.match_respond(uuid, boolean) to authenticated;

-- Open posts of the same giving world nearest in meaning to the post, nearest first; when
-- the post has no embedding yet, the newest ones sharing a word with its title.
create function kc_access.similar_post_ids(p_post_id uuid, p_limit integer)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_post public.posts;
  v_embedding extensions.vector;
  v_limit constant integer := least(greatest(coalesce(p_limit, 10), 1), 30);
begin
  select p.* into v_post from public.posts p where p.id = p_post_id;
  select e.embedding into v_embedding from public.post_embeddings e where e.post_id = p_post_id;
  if v_embedding is null then
    return array(
      select c.id from public.posts c
       where c.status = 'open' and c.world_slug = v_post.world_slug and c.id <> p_post_id
         and c.search_vector @@ kc_private.title_tsquery(v_post.title)
       order by c.published_at desc
       limit v_limit);
  end if;
  return array(
    select n.post_id
      from (select e.post_id, e.embedding operator(extensions.<=>) v_embedding as distance
              from public.post_embeddings e
             order by e.embedding operator(extensions.<=>) v_embedding
             limit 200) n
      join public.posts c on c.id = n.post_id
     where c.status = 'open' and c.world_slug = v_post.world_slug and c.id <> p_post_id
     order by n.distance
     limit v_limit);
end;
$$;
comment on function kc_access.similar_post_ids(uuid, integer) is
  'Candidate ids of posts similar to a post. The caller re-reads them under RLS.';
grant execute on function kc_access.similar_post_ids(uuid, integer) to authenticated;

-- "More like this" under a post: up to p_limit (at most 30) cards, most similar first.
-- Nothing is returned for a post the caller cannot read.
create function public.similar_posts(p_post_id uuid, p_limit integer default 10)
returns setof public.post_card
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_post_ids uuid[];
begin
  if not exists (select 1 from public.posts p where p.id = p_post_id) then
    return;
  end if;
  v_post_ids := kc_access.similar_post_ids(p_post_id, p_limit);
  return query
  select c.* from public.post_cards(v_post_ids) c order by array_position(v_post_ids, c.id);
end;
$$;
comment on function public.similar_posts(uuid, integer) is 'Posts similar to a post the caller can read, as cards.';
grant execute on function public.similar_posts(uuid, integer) to authenticated;

-- Open public posts nearest in meaning to what the caller recently saved or reacted to
-- (their last 20 of each), leaving out their own posts and the ones already saved or
-- reacted to. Empty until the caller has engaged with a post that has an embedding.
create function kc_access.recommended_post_ids(p_limit integer)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := (select auth.uid());
  v_taste extensions.vector;
begin
  select extensions.avg(e.embedding) into v_taste
    from ((select s.post_id from public.saved_posts s
            where s.user_id = v_user_id order by s.saved_at desc limit 20)
          union
          (select r.post_id from public.post_reactions r
            where r.user_id = v_user_id order by r.created_at desc limit 20)) liked
    join public.post_embeddings e on e.post_id = liked.post_id;
  if v_taste is null then
    return '{}';
  end if;
  return array(
    select n.post_id
      from (select e.post_id, e.embedding operator(extensions.<=>) v_taste as distance
              from public.post_embeddings e
             order by e.embedding operator(extensions.<=>) v_taste
             limit 200) n
      join public.posts c on c.id = n.post_id
     where c.status = 'open' and c.visibility = 'Public' and c.owner_id <> v_user_id
       and not exists (select 1 from public.saved_posts s where s.user_id = v_user_id and s.post_id = c.id)
       and not exists (select 1 from public.post_reactions r where r.user_id = v_user_id and r.post_id = c.id)
     order by n.distance
     limit least(greatest(coalesce(p_limit, 10), 1), 30));
end;
$$;
comment on function kc_access.recommended_post_ids(integer) is
  'Candidate ids of posts recommended to the caller. The caller re-reads them under RLS.';
grant execute on function kc_access.recommended_post_ids(integer) to authenticated;

-- "Recommended for you": up to p_limit (at most 30) cards, closest to the caller's taste first.
create function public.recommended_posts(p_limit integer default 10)
returns setof public.post_card
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_post_ids constant uuid[] := kc_access.recommended_post_ids(p_limit);
begin
  return query
  select c.* from public.post_cards(v_post_ids) c order by array_position(v_post_ids, c.id);
end;
$$;
comment on function public.recommended_posts(integer) is 'Posts recommended to the caller from what they saved and reacted to, as cards.';
grant execute on function public.recommended_posts(integer) to authenticated;
