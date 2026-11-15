-- Matching · triggering, the consumer of outbox topic `match`, announcements, re-rank
--
-- Nothing is matched or embedded while a member waits: a post write only records what has
-- to happen (design §5 "Trigger budget") and the work is done here, by a scheduled job, and
-- by the embed and re-rank Edge Functions.

-- Records the follow-up work of a post write:
--   topic `embedding`  { post_id }  the published text is new or changed
--   topic `match`      { post_id }  the post went on or off the air, or a field the score
--                                   reads changed while it is on the air
-- Two inserts at most, and none for a write that changes nothing either consumer reads.
create function kc_private.posts_enqueue_indexing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_open constant boolean := tg_op = 'UPDATE' and old.status = 'open';
  v_text_changed constant boolean := tg_op = 'INSERT' or old.status = 'draft'
    or new.title is distinct from old.title or new.description is distinct from old.description;
begin
  if new.status <> 'draft' and v_text_changed then
    perform kc_private.outbox_enqueue('embedding', jsonb_build_object('post_id', new.id));
  end if;
  if new.post_type = 'standard'
     and ((new.status = 'open') <> v_was_open
          or (v_was_open and (v_text_changed
               or row(new.item_subcategory_id, new.time_window, new.visibility, new.geo_approx::text)
                  is distinct from
                  row(old.item_subcategory_id, old.time_window, old.visibility, old.geo_approx::text)))) then
    perform kc_private.outbox_enqueue('match', jsonb_build_object('post_id', new.id));
  end if;
  return null;
end;
$$;
comment on function kc_private.posts_enqueue_indexing() is
  'AFTER trigger on posts: enqueues the embedding refresh and the matching run a write calls for.';

create trigger posts_enqueue_indexing
  after insert or update of status, title, description, item_subcategory_id, time_window, visibility,
    city_id, location_display_level, geo_approx
  on public.posts
  for each row execute function kc_private.posts_enqueue_indexing();

-- Tells the owners of fresh, good pairs about them: one `match_suggested` notification per
-- owner per pair, best pairs first, at most `max_notify_per_user_day` per member per Israel
-- day (spec 07 §7.11). An owner who already answered is not told. Quiet hours and the
-- member's own switch for this kind are the notification module's business. Returns the
-- number of notifications recorded.
create function kc_private.match_announce(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings kc_private.matching_settings;
  v_day_start constant timestamptz :=
    date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem';
  v_pair kc_private.match_candidates;
  v_side record;
  v_sent integer := 0;
begin
  select s.* into v_settings from kc_private.matching_settings s;
  if not v_settings.enabled then
    return 0;
  end if;
  for v_pair in
    select m.* from kc_private.match_candidates m
     where m.status = 'suggested' and (m.notified_offer_at is null or m.notified_request_at is null)
       and m.computed_at > now() - make_interval(hours => v_settings.notify_max_age_hours)
       and kc_private.match_effective_score(m.score, m.llm_score) >= v_settings.notify_min_score
     order by m.score desc
     limit least(greatest(p_limit, 1), 1000)
       for update skip locked
  loop
    for v_side in
      select * from (values
        ('offer', v_pair.offer_owner_id, v_pair.request_post_id,
         v_pair.notified_offer_at is null and v_pair.offer_response is null),
        ('request', v_pair.request_owner_id, v_pair.offer_post_id,
         v_pair.notified_request_at is null and v_pair.request_response is null)
      ) as s (side, owner_id, other_post_id, due)
    loop
      continue when not v_side.due
        or (select count(*) from kc_private.match_candidates x
             where (x.offer_owner_id = v_side.owner_id and x.notified_offer_at >= v_day_start)
                or (x.request_owner_id = v_side.owner_id and x.notified_request_at >= v_day_start))
           >= v_settings.max_notify_per_user_day;
      perform kc_private.outbox_enqueue('notification', jsonb_build_object(
        'kind', 'match_suggested', 'recipient_id', v_side.owner_id, 'actor_id', null,
        'entity', jsonb_build_object('type', 'match', 'id', v_pair.id),
        'data', jsonb_build_object('post_id', v_side.other_post_id, 'world_slug', v_pair.world_slug,
                                   'dedupe_key', 'match_suggested:' || v_pair.id || ':' || v_side.side)));
      update kc_private.match_candidates m
         set notified_offer_at = case v_side.side when 'offer' then now() else m.notified_offer_at end,
             notified_request_at = case v_side.side when 'request' then now() else m.notified_request_at end
       where m.id = v_pair.id;
      v_sent := v_sent + 1;
    end loop;
  end loop;
  return v_sent;
end;
$$;
comment on function kc_private.match_announce(integer) is
  'Enqueues match_suggested notifications for unannounced pairs above the announce score, within the daily cap.';

-- Worker entry point: claims due `match` events, recomputes each named post once, confirms
-- the events, then announces. A failing post is released for a retry with its error and
-- does not stop the batch. Returns the number of events performed. Needs no service
-- outside the database, so it is run by a scheduled job.
create function kc_private.match_process(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event record;
  v_seen uuid[] := '{}';
  v_done integer := 0;
begin
  for v_event in
    select e.id, (e.payload ->> 'post_id')::uuid as post_id
      from kc_private.outbox_claim('match', p_limit) e order by e.id
  loop
    begin
      if v_event.post_id <> all (v_seen) then
        perform kc_private.match_compute_for_post(v_event.post_id);
        v_seen := v_seen || v_event.post_id;
      end if;
      perform kc_private.outbox_complete(v_event.id);
      v_done := v_done + 1;
    exception when others then
      perform kc_private.outbox_complete(v_event.id, sqlerrm);
      update kc_private.match_state s set last_error = sqlerrm where s.post_id = v_event.post_id;
    end;
  end loop;
  perform kc_private.match_announce();
  return v_done;
end;
$$;
comment on function kc_private.match_process(integer) is
  'Claims and performs a batch of match events, then announces new pairs; run by a scheduled job.';

-- ── Language-model re-rank (Edge Function `match-rerank`) ───────────────────────────────

-- Pairs waiting for an opinion, newest first; empty while the re-rank is switched off.
create function public.api_match_llm_pending(p_limit integer default 20)
returns table (
  candidate_id uuid, world_slug text, score numeric,
  offer_title text, offer_summary text, request_title text, request_summary text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.world_slug, m.score, o.title, o.description, r.title, r.description
    from kc_private.match_candidates m
    join public.posts o on o.id = m.offer_post_id
    join public.posts r on r.id = m.request_post_id
   where m.status = 'suggested' and m.llm_scored_at is null
     and (select s.llm_rerank_enabled from kc_private.matching_settings s)
   order by m.computed_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;
comment on function public.api_match_llm_pending(integer) is
  'match-rerank: pairs without a language-model opinion. Service role only.';

-- Stores the opinion of a pair: a score 0..1 and a short reason.
--   invalid_input · match_not_found
create function public.api_match_llm_store(p_candidate_id uuid, p_score numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_score is null or p_score not between 0 and 1 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  update kc_private.match_candidates m
     set llm_score = p_score, llm_reason = left(nullif(btrim(p_reason), ''), 280), llm_scored_at = now()
   where m.id = p_candidate_id;
  if not found then
    raise exception 'match_not_found' using errcode = 'P0001';
  end if;
end;
$$;
comment on function public.api_match_llm_store(uuid, numeric, text) is
  'match-rerank: stores the language-model score and reason of a pair. Service role only.';
