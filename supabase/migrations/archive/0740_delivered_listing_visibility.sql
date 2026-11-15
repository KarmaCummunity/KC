-- 0740_delivered_listing_visibility | FR-POST-021 AC2/AC3, FR-POST-017, spec 07 §7.7 / §7.13,
-- D-28 / D-39 (closed-post dual surface), #2088 (visibility part).
--
-- A delivered (`closed_delivered`) post is seen by who the two sides let see it:
--   * the owner and the recipient always see it and can rate it, whatever either chose;
--   * everyone else sees it when EITHER side's surface admits them (union): `Public` admits
--     anyone (guests included), `FollowersOnly` admits that side's followers, `OnlyMe` admits
--     nobody. The side that did not want to be shown stays anonymous there (identity masking is
--     `hide_from_counterparty` / `OnlyMe`, FR-POST-021 AC4; unchanged);
--   * a side with a Private profile shows its deliveries to its followers only: its `Public`
--     surface counts as `FollowersOnly` (new);
--   * the recipient's default surface, when nothing was chosen, stays `Public`;
--   * an admin or operator sees every delivered listing.
-- The listing screen (`post_listing_visible_to`) used the owner-only rule of 0667, so a recipient
-- opened "listing not found" and could not rate. It now delegates delivered posts to
-- `is_post_visible_to`, so the listing and post screens cannot diverge.
--
-- The recipient is identified through `post_handoffs` (a `handed_over` handoff), not only the
-- legacy `recipients` table (`post_delivery_recipients`).
--
-- Second part, same cause: the handoff writers wrote a `recipients` row only for items (0559),
-- so a delivered food / animals post had no recipient: it never reached the recipient's
-- "closed posts" profile tab, never counted in items_received_count / items_given_count,
-- had no `marked_as_recipient` activity row, and the recipient fell outside every
-- recipients-based visibility rule. A trigger on `post_handoffs` now records the recipient
-- when a items / food / animals handoff becomes `handed_over`, for every writer, and the rows
-- missing for earlier hand-overs are backfilled. Karma is unchanged (the post karma triggers are
-- items-only since 0554; food and animals keep per-handoff karma, D63); the "marked as
-- recipient" notice is skipped (the hand-over notice, 0528, already told the recipient).
--
-- Deletion retention (#2088: keep the counterpart's post and handoff, show "משתמש שנמחק") is NOT
-- here: it changes the cascade of the account purge. Visibility already follows the remaining
-- party: with one side gone, the union above is decided by the side that is left.
-- Additive and idempotent.

begin;

-- ── 1. Recipients of a delivered post: handed-over handoffs and the legacy recipients row ─────
create or replace function public.post_delivery_recipients(p_post_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select h.recipient_id
    from public.post_handoffs h
   where h.post_id = p_post_id
     and h.status = 'handed_over'
     and h.recipient_id is not null
  union
  select r.recipient_user_id
    from public.recipients r
   where r.post_id = p_post_id
     and r.recipient_user_id is not null;
$$;

comment on function public.post_delivery_recipients(uuid) is
  '0740: the members a delivered post was handed to: recipients of its handed_over handoffs plus the legacy recipients row.';

revoke all on function public.post_delivery_recipients(uuid) from public, anon, authenticated;
grant execute on function public.post_delivery_recipients(uuid) to service_role;

-- ── 2. A participant's surface: a Private profile shows deliveries to followers only ──────────
create or replace function public.participant_closed_surface_visible(
  p_post   public.posts,
  p_actor  uuid,
  p_viewer uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sv text;
begin
  if p_actor is null then
    return false;
  end if;

  select pai.surface_visibility
    into v_sv
  from public.post_actor_identity pai
  where pai.post_id = p_post.post_id
    and pai.user_id = p_actor
  limit 1;

  if v_sv is null then
    if p_actor = p_post.owner_id then
      v_sv := p_post.visibility::text;
    else
      v_sv := 'Public';
    end if;
  end if;

  -- 0740: a Private profile's deliveries are for its followers only.
  if v_sv = 'Public' and exists (
    select 1 from public.users u where u.user_id = p_actor and u.privacy_mode = 'Private'
  ) then
    v_sv := 'FollowersOnly';
  end if;

  return case v_sv
    when 'Public'        then true
    when 'OnlyMe'        then false
    when 'FollowersOnly' then coalesce(public.is_following(p_viewer, p_actor), false)
    else true
  end;
end;
$$;

comment on function public.participant_closed_surface_visible(public.posts, uuid, uuid) is
  'D-28 / FR-POST-021 AC3: resolves a participant''s surface_visibility for a viewer. Falls back to posts.visibility for the publisher and to Public for the recipient; a Private profile''s Public surface counts as FollowersOnly (0740). SECURITY DEFINER to break RLS recursion through is_post_visible_to.';

-- ── 3. is_post_visible_to: the recipient comes from post_delivery_recipients ──────────────────
-- Body of 0643 with the closed_delivered branch reading post_delivery_recipients.
create or replace function public.is_post_visible_to(p_post posts, p_viewer uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select case
    when p_post.owner_id = p_viewer then true
    when p_viewer is distinct from p_post.owner_id
      and not exists (
        select 1 from public.users u
        where u.user_id = p_post.owner_id and u.account_status = 'active'
      ) then false
    when public.is_account_pending_deletion(p_post.owner_id) then false
    when public.is_blocked(p_viewer, p_post.owner_id) then false
    when exists (
      select 1 from public.reporter_hides h
      where h.reporter_id = p_viewer
        and h.target_type = 'post'
        and h.target_id   = p_post.post_id
    ) then false
    when p_post.status in ('removed_admin','hidden_pending_review','deleted_no_recipient','expired') then false
    when p_post.status = 'closed_delivered' then
      case
        when exists (
          select 1 from public.post_delivery_recipients(p_post.post_id) d(user_id)
          where d.user_id = p_viewer
        ) then true
        when public.participant_closed_surface_visible(p_post, p_post.owner_id, p_viewer) then true
        when exists (
          select 1 from public.post_delivery_recipients(p_post.post_id) d(user_id)
          where public.participant_closed_surface_visible(p_post, d.user_id, p_viewer)
        ) then true
        else false
      end
    when p_post.status = 'open' and p_post.visibility = 'Public' then true
    when p_post.status = 'open' and p_post.visibility = 'OnlyMe' then false
    when p_post.status = 'open' and p_post.visibility = 'FollowersOnly' then
      public.is_following(p_viewer, p_post.owner_id)
    else false
  end;
$function$;

comment on function public.is_post_visible_to(public.posts, uuid) is
  'Whether p_viewer may see p_post. Non-active owners are visible only to themselves (0643). A delivered post: its owner and recipient always, others by either side''s surface (0740).';

-- ── 4. post_listing_visible_to: a delivered listing follows the post rule ─────────────────────
-- Body of 0667; a closed_delivered post is decided by is_post_visible_to (or an operator).
create or replace function public.post_listing_visible_to(p_post public.posts, p_viewer uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if p_post.owner_id = p_viewer then
    return true;
  end if;

  if public.is_account_pending_deletion(p_post.owner_id) then
    return false;
  end if;

  if exists (
    select 1 from public.reporter_hides h
     where h.reporter_id = p_viewer
       and ((h.target_type = 'listing' and h.target_id = coalesce(p_post.legacy_listing_id, p_post.post_id))
         or (h.target_type = 'post' and h.target_id = p_post.post_id))
  ) then
    return false;
  end if;

  if p_post.moderation_status <> 'published' then
    return false;
  end if;

  if p_post.status not in ('open', 'closed_delivered') then
    return false;
  end if;

  if public.is_blocked(p_viewer, p_post.owner_id) then
    return false;
  end if;

  -- 0740: a delivered listing is seen as the post is (owner and recipient always, others by
  -- either side's surface); an admin or operator sees every one.
  if p_post.status = 'closed_delivered' then
    return public.is_listing_operator(p_viewer)
        or public.is_post_visible_to(p_post, p_viewer);
  end if;

  case p_post.visibility
    when 'Public' then
      return true;
    when 'FollowersOnly' then
      return public.is_following(p_viewer, p_post.owner_id);
    when 'OnlyMe' then
      return public.is_listing_operator(p_viewer);
    else
      return false;
  end case;
end;
$$;

-- ── 5. Record the recipient when an items / food / animals handoff is handed over ─────────────
create or replace function public.post_handoffs_record_recipient()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flag text := coalesce(current_setting('kc.closing_from_handoff', true), '');
begin
  -- One recipient per post: items, food and animals take one live handoff (0658). Knowledge,
  -- rides, housing and events hold many handoffs per post and keep them as the record.
  if new.world_slug not in ('items', 'food', 'animals') then
    return null;
  end if;
  if not exists (
    select 1 from public.posts p
     where p.post_id = new.post_id and p.status in ('open', 'closed_delivered')
  ) then
    return null;
  end if;

  -- The hand-over notice (0528) already told the recipient; skip the 0063 "marked" notice.
  perform set_config('kc.closing_from_handoff', 'on', true);
  insert into public.recipients (post_id, recipient_user_id, marked_at)
  values (new.post_id, new.recipient_id, coalesce(new.handed_over_at, now()))
  on conflict (post_id) do nothing;
  perform set_config('kc.closing_from_handoff', v_flag, true);
  return null;
end;
$$;

comment on function public.post_handoffs_record_recipient() is
  '0740: records the recipient of an items / food / animals post when its handoff becomes handed_over, so every reader of recipients (profile closed tab, counters, activity, visibility) sees food and animals too.';

revoke all on function public.post_handoffs_record_recipient() from public, anon, authenticated;
grant execute on function public.post_handoffs_record_recipient() to service_role;

drop trigger if exists post_handoffs_record_recipient_ins on public.post_handoffs;
create trigger post_handoffs_record_recipient_ins
  after insert on public.post_handoffs
  for each row
  when (new.status = 'handed_over')
  execute function public.post_handoffs_record_recipient();

drop trigger if exists post_handoffs_record_recipient_upd on public.post_handoffs;
create trigger post_handoffs_record_recipient_upd
  after update of status on public.post_handoffs
  for each row
  when (new.status = 'handed_over' and old.status is distinct from 'handed_over')
  execute function public.post_handoffs_record_recipient();

-- ── 6. Backfill: delivered items / food / animals posts with a handed-over handoff and no row ──
do $$
declare
  v_flag text := coalesce(current_setting('kc.closing_from_handoff', true), '');
begin
  perform set_config('kc.closing_from_handoff', 'on', true);
  insert into public.recipients (post_id, recipient_user_id, marked_at)
  select distinct on (h.post_id) h.post_id, h.recipient_id, coalesce(h.handed_over_at, now())
    from public.post_handoffs h
    join public.posts p on p.post_id = h.post_id
   where h.status = 'handed_over'
     and h.world_slug in ('items', 'food', 'animals')
     and p.status = 'closed_delivered'
     and h.recipient_id <> p.owner_id
     and not exists (select 1 from public.recipients r where r.post_id = h.post_id)
   order by h.post_id, h.handed_over_at desc nulls last
  on conflict (post_id) do nothing;
  perform set_config('kc.closing_from_handoff', v_flag, true);
end $$;

commit;
