-- 0460_notification_kind_preferences | FR-NOTIF-017, spec §7.11 (D26), KC#1120.
-- Per-type notification opt-outs, first used by match suggestions.
--   • notification_preferences.kinds: { <notification kind>: false } disables that kind.
--     Opt-out model: a missing key means "on", so existing rows are unchanged (no backfill).
--   • users_merge_notification_preferences: `kinds` is now merged per key, so toggling one
--     kind keeps the others (other top-level keys still replace, as before).
--   • match_deliver_pending: users who turned `match_suggested` off get no in-app, push or
--     WhatsApp match alert; their side is settled with delivery.<side>.opted_out = true.
--   • match_user_notified_today: opted-out sides no longer count toward the daily cap, so a
--     user who turns alerts back on gets the full cap.
-- Body of match_deliver_pending is 0425's, plus the opt-out gate and the `opted_out` counter.

begin;

-- Pure predicate shared by SQL callers; mirrors @kc/domain isNotificationKindEnabled.
create or replace function public.notification_kind_enabled(p_prefs jsonb, p_kind text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_prefs -> 'kinds' -> p_kind, 'true'::jsonb) is distinct from 'false'::jsonb;
$$;

comment on function public.notification_kind_enabled(jsonb, text) is
  'FR-NOTIF-017: false only when notification_preferences.kinds.<kind> is explicitly false.';

create or replace function public.users_merge_notification_preferences(p_user_id uuid, p_merge jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prefs jsonb;
begin
  if p_merge ? 'kinds' and jsonb_typeof(p_merge -> 'kinds') <> 'object' then
    raise exception 'kinds must be a json object' using errcode = '22023';
  end if;

  update public.users
     set notification_preferences =
           (notification_preferences || (p_merge - 'kinds'))
           || case
                when p_merge ? 'kinds' then jsonb_build_object('kinds',
                  coalesce(notification_preferences -> 'kinds', '{}'::jsonb) || (p_merge -> 'kinds'))
                else '{}'::jsonb
              end
   where user_id = p_user_id and user_id = auth.uid()
  returning notification_preferences into v_prefs;

  return v_prefs;
end;
$$;

comment on column public.users.notification_preferences is
  'FR-NOTIF-014/017 + KC#869: {critical,social,kinds:{<kind>:false},quietHours:{enabled,start,end,timezone}}. critical bypasses quiet hours; kinds merge per key.';

create or replace function public.match_user_notified_today(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from public.match_candidates
           where offer_owner_id = p_user and notified_offer_at > now() - interval '24 hours'
             and (delivery #>> '{offer,opted_out}') is distinct from 'true')::int
       + (select count(*) from public.match_candidates
           where request_owner_id = p_user and notified_request_at > now() - interval '24 hours'
             and (delivery #>> '{request,opted_out}') is distinct from 'true')::int;
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
  v_opted    integer := 0;
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
       and (m.world_slug = 'rides' or coalesce((m.components ->> 'text')::numeric, 0) >= v_set.notify_min_text)
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

      -- FR-NOTIF-017: the user turned match suggestions off. Settle this side without sending
      -- (no in-app, push or WhatsApp) so it stops taking a delivery slot on every sweep. The
      -- match itself stays visible in "Matches for you".
      if not public.notification_kind_enabled(
           (select u.notification_preferences from public.users u where u.user_id = v_user),
           'match_suggested') then
        update public.match_candidates
           set notified_offer_at   = case when v_side = 'offer' then now() else notified_offer_at end,
               notified_request_at = case when v_side = 'request' then now() else notified_request_at end,
               delivery = delivery || jsonb_build_object(v_side, jsonb_build_object('opted_out', true, 'at', now()))
         where candidate_id = r.candidate_id;
        v_opted := v_opted + 1;
        continue;
      end if;

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

  return jsonb_build_object('notified', v_sent, 'deferred_quiet_hours', v_deferred, 'capped', v_capped,
                            'opted_out', v_opted);
end;
$$;

revoke all on function public.notification_kind_enabled(jsonb, text) from public, anon;
grant execute on function public.notification_kind_enabled(jsonb, text) to authenticated, service_role;
revoke all on function public.users_merge_notification_preferences(uuid, jsonb) from public, anon;
grant execute on function public.users_merge_notification_preferences(uuid, jsonb) to authenticated;
revoke all on function public.match_user_notified_today(uuid) from public, anon, authenticated;
revoke all on function public.match_deliver_pending(integer, uuid) from public, anon, authenticated;
grant execute on function public.match_deliver_pending(integer, uuid) to service_role;

commit;
