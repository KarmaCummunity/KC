-- 0534_write_rate_limits | Issue #880
-- Abuse resistance / robustness: cap high-volume listing, handoff and follow writes.

begin;

insert into public.marketplace_rules (rule_code, world_slug, label_en)
values
  ('R-SEC-Listing-Write', null, 'Listing write rate limit'),
  ('R-SEC-Handoff-Write', null, 'Giving handoff request rate limit'),
  ('R-SEC-Follow-Write', null, 'Follow write rate limit')
on conflict (rule_code) do nothing;

insert into public.marketplace_rule_params (rule_code, param_key, param_value)
values
  ('R-SEC-Listing-Write', 'max_per_hour', '20'),
  ('R-SEC-Handoff-Write', 'max_per_hour', '30'),
  ('R-SEC-Follow-Write', 'max_per_hour', '100')
on conflict (rule_code, param_key) do nothing;

-- All write caps share the 0162 counter and error convention. Only direct
-- PostgREST client writes count; nested trigger work, seeds and sweeps do not.
create or replace function public.trg_write_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims text := coalesce(current_setting('request.jwt.claims', true), '');
  v_role text;
  v_actor uuid;
  v_max int;
begin
  if v_claims = '' or pg_trigger_depth() > 1 then
    return new;
  end if;

  begin
    v_role := v_claims::jsonb ->> 'role';
  exception when others then
    v_role := null;
  end;
  if coalesce(v_role, 'authenticated') not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_table_name = 'listings' then
    v_actor := new.owner_id;
  elsif tg_table_name = 'giving_handoffs' then
    v_actor := new.recipient_id;
  elsif tg_table_name = 'follow_edges' then
    v_actor := new.follower_id;
  end if;
  if v_actor is null then
    return new;
  end if;

  select (p.param_value #>> '{}')::int into v_max
    from public.marketplace_rule_params p
   where p.rule_code = tg_argv[0]
     and p.param_key = 'max_per_hour';
  if v_max is null or v_max < 1 then
    raise exception 'invalid_rate_limit_args' using errcode = '22023';
  end if;

  perform public.enforce_rate_limit(tg_argv[1] || ':' || v_actor::text, v_max, 3600);
  return new;
end;
$$;

revoke all on function public.trg_write_rate_limit() from public, anon, authenticated;

drop trigger if exists listings_rate_limit on public.listings;
create trigger listings_rate_limit before insert on public.listings
  for each row execute function public.trg_write_rate_limit('R-SEC-Listing-Write', 'listings');

drop trigger if exists giving_handoffs_rate_limit on public.giving_handoffs;
create trigger giving_handoffs_rate_limit before insert on public.giving_handoffs
  for each row execute function public.trg_write_rate_limit('R-SEC-Handoff-Write', 'giving_handoffs');

drop trigger if exists follow_edges_rate_limit on public.follow_edges;
create trigger follow_edges_rate_limit before insert on public.follow_edges
  for each row execute function public.trg_write_rate_limit('R-SEC-Follow-Write', 'follows');

comment on function public.trg_write_rate_limit() is
  'Abuse resistance / robustness: hourly write caps using enforce_rate_limit(); skips trusted and nested internal writes.';

commit;
