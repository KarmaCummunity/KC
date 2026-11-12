-- 0625_g1_listing_write_cap_on_posts | G1 step 6a-5a (ADR-006, D-214), issue #1671.
--
-- The hourly listing write cap (`R-SEC-Listing-Write`, 0534) moves with the record, as the
-- handoff cap did in 0555. `trg_write_rate_limit` counts only the write a client request makes
-- itself (trigger depth 1); since 0554 the create RPCs of the listing worlds (food, rides, housing,
-- time) write the post, and its listing is derived one trigger deeper. The cap therefore sits on
-- `posts` too, under the same rule code and bucket key as `listings`, so a post written by a
-- create RPC and a listing inserted directly draw on one hourly budget, and each publication is
-- counted once:
--   - a post-owned publication: the post insert counts; its derived listing runs at depth 2;
--   - a listing-sourced publication: the listing insert counts; its mirror post runs at depth 2
--     (and carries `listing_id`, which the trigger condition excludes as well).
-- Items posts stay outside this cap: they keep the active-posts cap (0002, FR-POST-011), as
-- 0554 left them. The function body is the 0555 definition plus the marked change. Idempotent.

begin;

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

  -- 0625: a post is counted for its owner, like the listing it derives.
  if tg_table_name in ('listings', 'posts') then
    v_actor := new.owner_id;
  elsif tg_table_name in ('giving_handoffs', 'post_handoffs') then
    -- Both handoff tables share one bucket (tg_argv[1]); the derived write of either side runs
    -- at trigger depth 2 and is skipped above, so a handoff is counted once.
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

-- A post of a listing world, written by its owner's request. Mirrors (`listing_id` set) follow
-- their listing, which was counted when it was inserted.
drop trigger if exists posts_rate_limit on public.posts;
create trigger posts_rate_limit before insert on public.posts
  for each row
  when (new.world_slug <> 'items' and new.listing_id is null)
  execute function public.trg_write_rate_limit('R-SEC-Listing-Write', 'listings');

commit;
