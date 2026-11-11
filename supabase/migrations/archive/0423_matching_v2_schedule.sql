-- 0423_matching_v2_schedule | Triggers, pg_cron sweep and LLM re-rank hooks for matching v2.
--
--   * listings AFTER INSERT / relevant UPDATE → compute this listing's candidates inline and
--     deliver to the counterparties (never fails the listing write; errors are recorded and
--     the sweep retries). Closing/expiring a listing expires its open pairs.
--   * match_run_sweep() every 10 min (pg_cron): expire stale pairs, recompute new/changed/old
--     listings in batches, deliver pending notifications (quiet-hours deferrals land here).
--   * api_match_llm_pending / api_match_llm_store: service-role hooks for the optional Gemini
--     re-rank worker (supabase/functions/match-rerank). No-ops while llm_rerank_enabled = false.

begin;

create or replace function public.match_on_listing_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set public.matching_settings;
begin
  select * into v_set from public.matching_settings where id;
  if not coalesce(v_set.enabled, false) or not (new.world_slug = any (v_set.worlds)) then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status <> 'open' and old.status = 'open' then
    update public.match_candidates
       set status = 'expired'
     where status = 'suggested'
       and (offer_listing_id = new.listing_id or request_listing_id = new.listing_id);
    return new;
  end if;

  if not v_set.inline_on_write then
    return new;
  end if;

  if tg_op = 'UPDATE' and not (
       new.status is distinct from old.status
       or new.moderation_status is distinct from old.moderation_status
       or new.anonymity_level is distinct from old.anonymity_level
       or new.title is distinct from old.title
       or new.summary is distinct from old.summary
       or new.category_id is distinct from old.category_id
       or new.geo is distinct from old.geo
       or new.city_id is distinct from old.city_id
       or new.time_window is distinct from old.time_window
       or new.details is distinct from old.details) then
    return new;
  end if;

  if new.status <> 'open' or new.moderation_status <> 'published' then
    return new;
  end if;

  begin
    perform public.match_compute_for_listing(new.listing_id);
    perform public.match_deliver_pending(50, new.listing_id);
  exception when others then
    -- Matching must never break publishing; the sweep retries.
    insert into public.match_listing_state (listing_id, computed_at, candidates, last_error)
    values (new.listing_id, '-infinity', 0, left(sqlerrm, 500))
    on conflict (listing_id) do update
      set computed_at = '-infinity', last_error = left(excluded.last_error, 500);
  end;
  return new;
end;
$$;

drop trigger if exists listings_match_v2 on public.listings;
create trigger listings_match_v2
  after insert or update on public.listings
  for each row execute function public.match_on_listing_write();

create or replace function public.match_run_sweep(p_batch integer default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_set      public.matching_settings;
  v_expired  integer := 0;
  v_done     integer := 0;
  v_failed   integer := 0;
  v_pairs    integer := 0;
  v_delivery jsonb;
  r          record;
begin
  select * into v_set from public.matching_settings where id;
  if not coalesce(v_set.enabled, false) then
    return jsonb_build_object('skipped', 'disabled');
  end if;

  update public.match_candidates m
     set status = 'expired'
    from public.listings o, public.listings q
   where m.status = 'suggested'
     and o.listing_id = m.offer_listing_id
     and q.listing_id = m.request_listing_id
     and (o.status <> 'open' or q.status <> 'open'
          or coalesce(o.expires_at, 'infinity') <= now()
          or coalesce(q.expires_at, 'infinity') <= now());
  get diagnostics v_expired = row_count;

  for r in
    select l.listing_id
      from public.listings l
      left join public.match_listing_state st on st.listing_id = l.listing_id
     where l.status = 'open'
       and l.moderation_status = 'published'
       and l.anonymity_level > 1
       and l.world_slug = any (v_set.worlds)
       and (l.expires_at is null or l.expires_at > now())
       and (st.listing_id is null
            or st.computed_at < l.updated_at
            or st.computed_at < now() - make_interval(hours => v_set.recompute_after_hours))
     order by st.computed_at nulls first, l.created_at desc
     limit coalesce(p_batch, v_set.sweep_batch)
  loop
    begin
      v_pairs := v_pairs + public.match_compute_for_listing(r.listing_id);
      v_done := v_done + 1;
    exception when others then
      v_failed := v_failed + 1;
      insert into public.match_listing_state (listing_id, computed_at, candidates, last_error)
      values (r.listing_id, now(), 0, left(sqlerrm, 500))
      on conflict (listing_id) do update set computed_at = now(), last_error = left(excluded.last_error, 500);
    end;
  end loop;

  v_delivery := public.match_deliver_pending(500, null);

  return jsonb_build_object('expired', v_expired, 'computed', v_done, 'failed', v_failed,
                            'pairs', v_pairs, 'delivery', v_delivery);
end;
$$;

comment on function public.match_run_sweep(integer) is
  'Matching v2 pg_cron job: expire stale pairs, recompute new/changed/old listings, deliver pending.';

-- LLM re-rank hooks (service role; the edge worker no-ops without GEMINI_API_KEY) ------------
create or replace function public.api_match_llm_pending(p_limit integer default 20)
returns table (
  candidate_id   uuid,
  world_slug     text,
  score          numeric,
  offer_title    text,
  offer_summary  text,
  request_title  text,
  request_summary text
)
language sql
stable
security definer
set search_path = public
as $$
  select m.candidate_id, m.world_slug, m.score, o.title, o.summary, q.title, q.summary
    from public.match_candidates m
    join public.listings o on o.listing_id = m.offer_listing_id
    join public.listings q on q.listing_id = m.request_listing_id
   where (select s.llm_rerank_enabled from public.matching_settings s where s.id)
     and m.status = 'suggested'
     and m.llm_scored_at is null
   order by m.score desc, m.computed_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

create or replace function public.api_match_llm_store(p_candidate_id uuid, p_score numeric, p_reason text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_score is null or p_score < 0 or p_score > 1 then
    raise exception 'invalid_llm_score' using errcode = '22023';
  end if;
  update public.match_candidates
     set llm_score = round(p_score, 4),
         llm_reason = left(nullif(btrim(p_reason), ''), 280),
         llm_scored_at = now()
   where candidate_id = p_candidate_id;
  return found;
end;
$$;

revoke all on function public.match_on_listing_write() from public, anon, authenticated;
revoke all on function public.match_run_sweep(integer) from public, anon, authenticated;
revoke all on function public.api_match_llm_pending(integer) from public, anon, authenticated;
revoke all on function public.api_match_llm_store(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.match_run_sweep(integer) to service_role;
grant execute on function public.api_match_llm_pending(integer) to service_role;
grant execute on function public.api_match_llm_store(uuid, numeric, text) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'matching_v2_sweep') then
      perform cron.unschedule('matching_v2_sweep');
    end if;
    perform cron.schedule('matching_v2_sweep', '*/10 * * * *', $sql$ select public.match_run_sweep(); $sql$);
  else
    raise notice 'pg_cron not enabled — matching_v2_sweep not scheduled.';
  end if;
end $$;

commit;
