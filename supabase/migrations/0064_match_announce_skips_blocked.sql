-- Matching · never announce a pair whose owners block each other (FR-MOD-009 AC1, D105, KC#2076)
--
-- Scoring already drops blocked pairs, but a block made after the pair was computed left it
-- `suggested`, and the cron-driven announce runs without auth.uid(), so the notification
-- layer could not suppress it. The announce now checks the block itself.

create or replace function kc_private.match_announce(p_limit integer default 200)
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
       -- A block made after the pair was computed still keeps it silent.
       and not kc_access.is_blocked_between(m.offer_owner_id, m.request_owner_id)
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
