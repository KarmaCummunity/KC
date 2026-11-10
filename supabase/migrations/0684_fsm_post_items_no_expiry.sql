-- 0684_fsm_post_items_no_expiry — wave 1b-iii of docs/architecture/state-machines.md (#1989).
--
-- D21 (spec 07 §7.1): "items and all requests — no expiry; the owner gets relevance
-- reminders instead". 0450 removed item expiry, but the legacy listings world rules gave a
-- new item `expires_at = now() + 30 days` (0612) and 0666 copied that default into the posts
-- trigger. No sweep ever expired an item, yet the date was read: matching v2 skips a
-- candidate past its `expires_at` (0635), and the post graph refuses to resume a paused post
-- past it (0681). So an item older than 30 days silently stopped being matched, and pausing
-- it could not be undone.
--
-- 1. `posts_enforce_world_rules` (0666 body) no longer sets an expiry on items.
-- 2. Existing items lose the defaulted date. The item form has no expiry field, so every
--    item `expires_at` came from that default.

begin;

-- ── 1. World rules without the item expiry default ────────────────────────────
create or replace function public.posts_enforce_world_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_rides numeric;
  v_cost numeric;
  v_active_money int;
  v_min_age int := 18;
  v_birth date;
begin
  if exists (
    select 1 from public.users u
     where u.user_id = new.owner_id and u.food_posting_banned_until > now()
  ) and new.world_slug = 'food' then
    raise exception 'food_posting_banned' using errcode = '42501';
  end if;

  -- D28: food offer carries the giver's expiry. D21: food request has none.
  if new.world_slug = 'food' and (new.direction in ('give', 'offer') or new.type = 'Give') then
    new.expires_at := coalesce(new.expires_at, nullif(new.details->>'expires_at', '')::timestamptz);
    if new.expires_at is null then
      raise exception 'food_expiry_required' using errcode = '23514';
    end if;
    if tg_op = 'INSERT' and new.expires_at <= now() then
      new.status := 'expired';
    end if;
  end if;

  -- D21: items have no expiry (the owner gets relevance reminders instead, 0450). The
  -- 30-day default copied here from the legacy listings rules (0612, 0666) is gone.

  if new.world_slug = 'rides' then
    if to_regproc('ride_details_with_place') is not null then
      new.details := public.ride_details_with_place(coalesce(new.details, '{}'::jsonb), 'origin');
      new.details := public.ride_details_with_place(new.details, 'dest');
    end if;

    begin
      declare
        v_departs timestamptz := nullif(new.details->>'departs_at', '')::timestamptz;
        v_arrives timestamptz := nullif(new.details->>'arrives_at', '')::timestamptz;
      begin
        if (new.direction in ('give', 'offer') or new.type = 'Give') and coalesce(v_arrives, v_departs) is not null then
          if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.details is distinct from old.details) then
            new.expires_at := coalesce(v_arrives, v_departs) + interval '30 minutes';
          end if;
        end if;
      end;
    exception when others then
      null;
    end;

    v_cost := nullif(new.details->>'cost_share_ils', '')::numeric;
    if v_cost is not null then
      select (param_value #>> '{}')::numeric into v_max_rides
        from public.marketplace_rule_params
       where rule_code = case when new.direction in ('give', 'offer') or new.type = 'Give' then 'R-Rides-1' else 'R-Rides-2' end
         and param_key = 'max_cost_share_ils';
      if v_max_rides is not null and v_cost > v_max_rides then
        raise exception 'ride_cost_share_cap_exceeded' using errcode = '23514';
      end if;
    end if;
  end if;

  if new.world_slug in ('medical','environment') and new.external_body_id is null then
    raise exception 'routed_world_requires_external_body' using errcode = '23514';
  end if;

  if new.world_slug = 'knowledge' and tg_op = 'INSERT' then
    new.moderation_status := 'pending_review';
  end if;

  if new.world_slug = 'money' and new.status = 'open' then
    select count(*) into v_active_money
      from public.posts p
     where p.owner_id = new.owner_id
       and p.world_slug = 'money'
       and p.status = 'open'
       and p.post_id is distinct from new.post_id;
    if v_active_money >= 5 then
      raise exception 'money_active_campaign_cap' using errcode = '23514';
    end if;
  end if;

  if public.is_event_kind(new.kind_id) then
    if (new.details ->> 'ends_at')::timestamptz <= (new.details ->> 'starts_at')::timestamptz then
      raise exception 'event_window_invalid' using errcode = '23514';
    end if;
  end if;

  if new.world_slug = 'romantic_matchmaking' then
    v_birth := nullif(new.details->>'birth_date', '')::date;
    if v_birth is not null and age(v_birth) < (v_min_age || ' years')::interval then
      raise exception 'matchmaking_min_age' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.posts_enforce_world_rules() from public, anon, authenticated;
grant execute on function public.posts_enforce_world_rules() to service_role;

-- ── 2. Existing items lose the defaulted expiry ──────────────────────────────
update public.posts
   set expires_at = null
 where world_slug = 'items'
   and expires_at is not null;

commit;
