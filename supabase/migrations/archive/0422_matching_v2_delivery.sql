-- 0422_matching_v2_delivery | Delivery + responses for matching v2.
--
-- match_deliver_pending(): notifies each side of a fresh, strong-enough pair once:
--   * in-app (notifications_outbox → inbox + push, kind 'match_suggested'),
--   * WhatsApp match_found_v1 through api_whatsapp_queue_outbound (templates-as-code #963)
--     only when the channel is enabled AND the user can receive (opt-in, no STOP #957);
--     otherwise it records 'skipped_*' and sends nothing (clean no-op without tokens).
--   Gates: per-user daily cap, quiet hours (user prefs, else platform window), freshness
--   (newest listing of the pair < notify_max_age_hours, so backfills don't blast old pairs),
--   and the acting user is never notified in their own transaction (cron picks it up).
-- rpc_match_respond(): accept/decline per side; a decline closes the pair and blocks the two
--   owners from being re-paired; both accepts → 'accepted' + mutual notifications. Responses
--   feed back into scoring (match_user_feedback / match_owners_declined).
-- rpc_my_matches(): "Matches for you" for the caller.

begin;

create or replace function public.match_in_quiet_hours(p_user uuid, p_at timestamptz default now())
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_prefs jsonb;
  v_set   public.matching_settings;
  v_local time;
begin
  select u.notification_preferences into v_prefs from public.users u where u.user_id = p_user;
  if coalesce((v_prefs -> 'quietHours' ->> 'enabled')::boolean, false) then
    return public.notification_in_quiet_hours(v_prefs, p_at);
  end if;
  select * into v_set from public.matching_settings where id;
  v_local := (p_at at time zone coalesce(v_set.quiet_tz, 'Asia/Jerusalem'))::time;
  if v_set.quiet_start <= v_set.quiet_end then
    return v_local >= v_set.quiet_start and v_local < v_set.quiet_end;
  end if;
  return v_local >= v_set.quiet_start or v_local < v_set.quiet_end;
end;
$$;

create or replace function public.match_user_notified_today(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from public.match_candidates
           where offer_owner_id = p_user and notified_offer_at > now() - interval '24 hours')::int
       + (select count(*) from public.match_candidates
           where request_owner_id = p_user and notified_request_at > now() - interval '24 hours')::int;
$$;

-- WhatsApp proactive send, or a recorded no-op. Returns the outcome label.
create or replace function public.match_whatsapp_send(p_user uuid, p_template text, p_payload jsonb)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_out uuid;
  v_status text;
begin
  if not exists (select 1 from public.whatsapp_channel_config c where c.is_enabled) then
    return 'skipped_channel_disabled';
  end if;
  if not public.whatsapp_user_can_receive(p_user) then
    return 'skipped_no_consent';
  end if;
  v_out := public.api_whatsapp_queue_outbound(p_user, p_template, p_payload);
  select b.status into v_status from public.bot_outbound_messages b where b.outbound_id = v_out;
  return coalesce(v_status, 'unknown');
end;
$$;

create or replace function public.match_deliver_pending(p_limit integer default 200, p_listing_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_set      public.matching_settings;
  v_actor    uuid := auth.uid();
  r          record;
  v_side     text;
  v_user     uuid;
  v_own      public.listings;
  v_other    public.listings;
  v_inapp    uuid;
  v_wa       text;
  v_label_he text;
  v_label_en text;
  v_sent     integer := 0;
  v_deferred integer := 0;
  v_capped   integer := 0;
begin
  select * into v_set from public.matching_settings where id;
  if not coalesce(v_set.enabled, false) then
    return jsonb_build_object('skipped', 'disabled');
  end if;

  for r in
    select m.*
      from public.match_candidates m
      join public.listings o on o.listing_id = m.offer_listing_id
      join public.listings q on q.listing_id = m.request_listing_id
     where m.status = 'suggested'
       and m.score >= v_set.notify_min_score
       and (m.notified_offer_at is null or m.notified_request_at is null)
       and greatest(o.created_at, q.created_at) > now() - make_interval(hours => v_set.notify_max_age_hours)
       and (p_listing_id is null or p_listing_id in (m.offer_listing_id, m.request_listing_id))
     order by m.score desc, m.computed_at desc
     limit greatest(coalesce(p_limit, 200), 1)
     for update of m skip locked
  loop
    foreach v_side in array array['offer', 'request'] loop
      if v_side = 'offer' then
        continue when r.notified_offer_at is not null or r.offer_response is not null;
        v_user := r.offer_owner_id;
        select * into v_own from public.listings where listing_id = r.offer_listing_id;
        select * into v_other from public.listings where listing_id = r.request_listing_id;
      else
        continue when r.notified_request_at is not null or r.request_response is not null;
        v_user := r.request_owner_id;
        select * into v_own from public.listings where listing_id = r.request_listing_id;
        select * into v_other from public.listings where listing_id = r.offer_listing_id;
      end if;

      -- enqueue_notification suppresses the acting user; leave their side for the cron run.
      continue when v_actor is not null and v_user = v_actor;

      if public.match_in_quiet_hours(v_user) then
        v_deferred := v_deferred + 1;
        continue;
      end if;
      if public.match_user_notified_today(v_user) >= v_set.max_notify_per_user_day then
        v_capped := v_capped + 1;
        continue;
      end if;

      select w.label_he, w.label_en into v_label_he, v_label_en from public.worlds w where w.slug = r.world_slug;

      v_inapp := public.enqueue_notification(
        v_user, 'social', 'match_suggested',
        'notifications.matchSuggestedTitle', 'notifications.matchSuggestedBody',
        jsonb_build_object('otherTitle', left(v_other.title, 80), 'myTitle', left(v_own.title, 80),
                           'worldHe', coalesce(v_label_he, r.world_slug), 'worldEn', coalesce(v_label_en, r.world_slug)),
        jsonb_build_object('candidate_id', r.candidate_id, 'listing_id', v_own.listing_id, 'route', '/matches',
                           'params', jsonb_build_object('id', r.candidate_id::text)),
        'match_cand:' || r.candidate_id::text || ':' || v_side,
        false
      );

      v_wa := public.match_whatsapp_send(
        v_user, 'match_found_v1',
        jsonb_build_object('candidate_id', r.candidate_id, 'world', r.world_slug, 'role', v_side,
                           'world_label_he', coalesce(v_label_he, r.world_slug),
                           'world_label_en', coalesce(v_label_en, r.world_slug))
      );

      if v_side = 'offer' then
        update public.match_candidates
           set notified_offer_at = now(),
               delivery = delivery || jsonb_build_object('offer', jsonb_build_object(
                 'inapp', v_inapp is not null, 'whatsapp', v_wa, 'at', now()))
         where candidate_id = r.candidate_id;
      else
        update public.match_candidates
           set notified_request_at = now(),
               delivery = delivery || jsonb_build_object('request', jsonb_build_object(
                 'inapp', v_inapp is not null, 'whatsapp', v_wa, 'at', now()))
         where candidate_id = r.candidate_id;
      end if;
      v_sent := v_sent + 1;
    end loop;
  end loop;

  return jsonb_build_object('notified', v_sent, 'deferred_quiet_hours', v_deferred, 'capped', v_capped);
end;
$$;

comment on function public.match_deliver_pending(integer, uuid) is
  'Matching v2: in-app + WhatsApp (consent/STOP/channel-gated) delivery with daily cap and quiet hours.';

create or replace function public.match_effective_score(p_score numeric, p_llm numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_llm is not null and (select s.llm_rerank_enabled from public.matching_settings s where s.id)
      then round((1 - s.llm_weight) * p_score + s.llm_weight * p_llm, 4)
    else p_score
  end
  from public.matching_settings s where s.id;
$$;

create or replace function public.rpc_match_respond(p_candidate_id uuid, p_response text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  m       public.match_candidates;
  v_side  text;
  v_other uuid;
  v_resp  text;
  v_offer public.listings;
  v_name  text;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if p_response not in ('accept', 'decline') then
    raise exception 'invalid_response' using errcode = '22023';
  end if;
  v_resp := case p_response when 'accept' then 'accepted' else 'declined' end;

  select * into m from public.match_candidates where candidate_id = p_candidate_id for update;
  if not found then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if m.offer_owner_id = v_uid then
    v_side := 'offer'; v_other := m.request_owner_id;
  elsif m.request_owner_id = v_uid then
    v_side := 'request'; v_other := m.offer_owner_id;
  else
    raise exception 'not_match_participant' using errcode = '42501';
  end if;
  if m.status not in ('suggested', 'accepted') then
    raise exception 'match_closed' using errcode = '22023';
  end if;

  if v_side = 'offer' then
    update public.match_candidates
       set offer_response = v_resp, offer_responded_at = now()
     where candidate_id = p_candidate_id
     returning * into m;
  else
    update public.match_candidates
       set request_response = v_resp, request_responded_at = now()
     where candidate_id = p_candidate_id
     returning * into m;
  end if;

  if v_resp = 'declined' then
    update public.match_candidates set status = 'declined'
     where candidate_id = p_candidate_id returning * into m;
    return jsonb_build_object('status', m.status, 'mutual', false);
  end if;

  select * into v_offer from public.listings where listing_id = m.offer_listing_id;
  select coalesce(u.display_name, '') into v_name from public.users u where u.user_id = v_uid;

  if m.offer_response = 'accepted' and m.request_response = 'accepted' then
    update public.match_candidates set status = 'accepted'
     where candidate_id = p_candidate_id returning * into m;
    perform public.enqueue_notification(
      v_other, 'social', 'match_accepted',
      'notifications.matchAcceptedTitle', 'notifications.matchAcceptedBody',
      jsonb_build_object('partnerName', v_name, 'listingTitle', left(v_offer.title, 80)),
      jsonb_build_object('candidate_id', m.candidate_id, 'route', '/matches', 'params', jsonb_build_object('id', m.candidate_id::text)),
      'match_cand:' || m.candidate_id::text || ':accepted:' || v_other::text, false
    );
    perform public.match_whatsapp_send(
      v_other, 'confirm_handoff_v1',
      jsonb_build_object('candidate_id', m.candidate_id, 'partner_name', coalesce(nullif(v_name, ''), 'Karma'),
                         'listing_title', left(v_offer.title, 80))
    );
    return jsonb_build_object('status', m.status, 'mutual', true);
  end if;

  -- One side accepted: let the other side know someone is interested (once).
  perform public.enqueue_notification(
    v_other, 'social', 'match_interest',
    'notifications.matchInterestTitle', 'notifications.matchInterestBody',
    jsonb_build_object('partnerName', v_name, 'listingTitle', left(v_offer.title, 80)),
    jsonb_build_object('candidate_id', m.candidate_id, 'route', '/matches', 'params', jsonb_build_object('id', m.candidate_id::text)),
    'match_cand:' || m.candidate_id::text || ':interest:' || v_other::text, false
  );
  return jsonb_build_object('status', m.status, 'mutual', false);
end;
$$;

comment on function public.rpc_match_respond(uuid, text) is
  'Matching v2: caller accepts/declines a pair they are part of. Decline closes it and blocks re-pairing.';

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
   where (case when x.role = 'offer' then x.offer_response else x.request_response end) is distinct from 'declined'
     and (x.status = 'accepted' or (own.status = 'open' and oth.status = 'open'))
     and public.is_listing_visible_to(oth, me.uid)
   order by (x.status = 'accepted') desc, public.match_effective_score(x.score, x.llm_score) desc, x.computed_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

comment on function public.rpc_my_matches(integer) is
  'Matching v2: the caller''s open/accepted pairs (counterpart listing must stay visible to them).';

-- Manual refresh of the caller's open listings (throttled: 10 minutes per listing).
create or replace function public.rpc_match_refresh_mine()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n   integer := 0;
  r     record;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  for r in
    select l.listing_id
      from public.listings l
      left join public.match_listing_state st on st.listing_id = l.listing_id
     where l.owner_id = v_uid
       and l.status = 'open'
       and (st.computed_at is null or st.computed_at < now() - interval '10 minutes')
     order by l.created_at desc
     limit 20
  loop
    v_n := v_n + public.match_compute_for_listing(r.listing_id);
  end loop;
  return v_n;
end;
$$;

revoke all on function public.match_in_quiet_hours(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.match_user_notified_today(uuid) from public, anon, authenticated;
revoke all on function public.match_whatsapp_send(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.match_deliver_pending(integer, uuid) from public, anon, authenticated;
revoke all on function public.match_effective_score(numeric, numeric) from public, anon;
revoke all on function public.rpc_match_respond(uuid, text) from public, anon;
revoke all on function public.rpc_my_matches(integer) from public, anon;
revoke all on function public.rpc_match_refresh_mine() from public, anon;
grant execute on function public.match_deliver_pending(integer, uuid) to service_role;
grant execute on function public.match_effective_score(numeric, numeric) to authenticated, service_role;
grant execute on function public.rpc_match_respond(uuid, text) to authenticated;
grant execute on function public.rpc_my_matches(integer) to authenticated;
grant execute on function public.rpc_match_refresh_mine() to authenticated;

commit;
