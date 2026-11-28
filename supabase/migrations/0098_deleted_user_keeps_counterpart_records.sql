-- Deleted user · the other member's records survive the account purge (#2088)
--
-- Until now the purge deleted `auth.users`, and every row of the member cascaded with it:
-- their posts, and with each post its handoffs; and every handoff they took part in, because
-- `post_handoffs.owner_id` and `recipient_id` cascaded too. A member who gave something away
-- lost the record of it when the receiver deleted their account, and the other way round.
--
-- Owner decision (Nave, 2026-11-10): the record of the other member stays, and the deleted
-- member is shown as "משתמש שנמחק" / "Deleted user". The app renders that from "no user"
-- (a null id), as chats already do for a deleted counterpart (FR-CHAT-013). Nothing is stored.
--
--   1. `posts.owner_id`, `post_handoffs.owner_id` and `post_handoffs.recipient_id` are
--      nullable and `on delete set null`. NULL means "a member who deleted their account".
--      `post_handoffs_distinct_members_chk` says so explicitly (a NULL side passes).
--   2. `kc_private.account_keep_counterpart_records(user)` runs before a `public.users` row
--      is deleted, on every path (the purge's `account_purge_finish`, a direct deletion of the
--      auth identity, a test). It ends the member's live handoffs, deletes the member's posts
--      that are nobody else's record (as the cascade did), and keeps each post that has a
--      handed-over handoff with another member who still exists. Those posts lose what
--      belonged to the deleted owner: the title becomes '—', and the description, the
--      photos, the address (street, exact point, private notes, ride streets and meeting
--      points and notes, event address) and the translations go. The city stays (it is
--      NOT NULL and is the coarsest place). So do the structured details, the category, the
--      dates and the counterpart's own rating and karma. A post of an already deleted owner
--      whose last remaining counterpart is the member is deleted: nobody is left whose record
--      it is. The function is idempotent: run again, it changes nothing.
--   3. When an account enters `pending_deletion`, its live handoffs (waitlisted, reserved,
--      confirmed, as owner or as recipient) are cancelled with reason `system`. The usual
--      handoff effects notify the counterpart (`<machine>_cancelled`, with
--      `cancel_reason = 'system'`) and not the member who acted. A freed event seat promotes
--      the waiting list. Restoring the account does not bring the handoffs back.
--   4. Reads: `posts_select_handoff_party` (the receiver reads the post they received) and
--      `post_cards` with its worker `kc_access.post_card_rows` (every card surface: detail,
--      feed, search, profile) accept a post whose
--      owner is NULL. Its card has `owner_id`, the owner's name, handle, avatar and level
--      all NULL, and `owner_identity_masked = false`. A hidden-name post has
--      `owner_identity_masked = true`, so the two cases never look the same. A post of a
--      deleted owner is never public: `posts_select_visible` still needs the owner's
--      `users` row, so only its counterpart and staff read it.
--   5. Guards that compared a member with `not in (owner_id, recipient_id)` or `<>` would
--      let anyone through once a side is NULL (`x not in (y, null)` is NULL, not true).
--      They now use `is distinct from`. `rate_handoff` refuses to rate a deleted member
--      (`counterpart_deleted`).
--
-- There is no `recipients` table or `listings` / `giving_handoffs` view after the baseline
-- cut-over (D-228): the receiver of a post is its handed-over handoff. Search goes through
-- `feed_page` → `post_cards`, so 4. covers it. No table keeps a copy of a member's name, so
-- once the `users` row is gone no join can return it.
--
-- Locks: on kc-dev `posts` has about 1,000 rows and `post_handoffs` about 130. Dropping NOT
-- NULL does not scan. Each foreign key is replaced in one ALTER TABLE `not valid` (a brief
-- ACCESS EXCLUSIVE lock, no scan), then validated under SHARE UPDATE EXCLUSIVE, which does not
-- block reads or writes.
--
-- Rollback: delete or reassign the rows whose owner or recipient is NULL, put back the
-- `on delete cascade` foreign keys and NOT NULL, the previous check, policy and functions
-- (`0001_baseline.sql`; `post_cards` and `kc_access.post_card_rows` from the
-- `post_read_visibility_gate` migration of #2648), and drop the two
-- triggers and the two kc_private functions below.

-- ── 1. Nullable members, set null on delete ─────────────────────────────────────────────

alter table public.posts alter column owner_id drop not null;
alter table public.posts
  drop constraint posts_owner_id_fkey,
  add constraint posts_owner_id_fkey foreign key (owner_id)
    references public.users (id) on delete set null not valid;
alter table public.posts validate constraint posts_owner_id_fkey;

alter table public.post_handoffs alter column owner_id drop not null;
alter table public.post_handoffs alter column recipient_id drop not null;
alter table public.post_handoffs
  drop constraint post_handoffs_owner_id_fkey,
  add constraint post_handoffs_owner_id_fkey foreign key (owner_id)
    references public.users (id) on delete set null not valid,
  drop constraint post_handoffs_recipient_id_fkey,
  add constraint post_handoffs_recipient_id_fkey foreign key (recipient_id)
    references public.users (id) on delete set null not valid,
  drop constraint post_handoffs_distinct_members_chk,
  add constraint post_handoffs_distinct_members_chk
    check (owner_id is null or recipient_id is null or owner_id <> recipient_id) not valid;
alter table public.post_handoffs validate constraint post_handoffs_owner_id_fkey;
alter table public.post_handoffs validate constraint post_handoffs_recipient_id_fkey;
alter table public.post_handoffs validate constraint post_handoffs_distinct_members_chk;

comment on column public.posts.owner_id is
  'The member who posted; NULL once they deleted their account and the post is another member''s record (#2088).';
comment on column public.post_handoffs.owner_id is
  'Owner of the post; NULL once that member deleted their account (#2088).';
comment on column public.post_handoffs.recipient_id is
  'The other member; NULL once that member deleted their account (#2088).';

-- ── 2. The live handoffs of a member end ────────────────────────────────────────────────

create function kc_private.account_cancel_live_handoffs(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_handoff public.post_handoffs;
  v_events uuid[] := '{}';
  v_post_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select h.id from public.post_handoffs h
     where (h.owner_id = p_user_id or h.recipient_id = p_user_id)
       and h.status in ('waitlisted', 'reserved', 'confirmed')
     order by h.id
  loop
    v_handoff := kc_private.handoff_lock(v_id);
    continue when v_handoff.status not in ('waitlisted', 'reserved', 'confirmed');
    perform kc_private.handoff_move(v_id, 'cancelled', 'system', 'system');
    v_count := v_count + 1;
    if v_handoff.machine_id = 'event_registration'
       and v_handoff.owner_id is distinct from p_user_id then
      v_events := v_events || v_handoff.post_id;
    end if;
  end loop;
  -- The seat the member held at someone else's event goes to the waiting list.
  foreach v_post_id in array v_events loop
    perform kc_private.event_promote_waitlist(v_post_id);
  end loop;
  return v_count;
end;
$$;
comment on function kc_private.account_cancel_live_handoffs(uuid) is
  'Cancels (reason system) every waitlisted, reserved or confirmed handoff of a member, as owner or recipient; the counterpart is notified by the handoff effects (#2088).';
revoke all on function kc_private.account_cancel_live_handoffs(uuid) from public, anon, authenticated;

create function kc_private.user_account_enter_pending_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.account_cancel_live_handoffs(new.user_id);
  return null;
end;
$$;
comment on function kc_private.user_account_enter_pending_deletion() is
  'An account that asks to be deleted ends its live handoffs at once (#2088).';
revoke all on function kc_private.user_account_enter_pending_deletion() from public, anon, authenticated;

create trigger user_account_enter_pending_deletion
  after update of status on public.user_account
  for each row
  when (new.status = 'pending_deletion' and old.status is distinct from 'pending_deletion')
  execute function kc_private.user_account_enter_pending_deletion();

-- ── 3. What survives the deletion of a member ───────────────────────────────────────────

create function kc_private.account_keep_counterpart_records(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kept uuid[];
begin
  -- Nothing may stay live with a side about to become NULL.
  perform kc_private.account_cancel_live_handoffs(p_user_id);

  -- The member's posts that are another member's record: a handover to someone who still
  -- exists.
  select coalesce(array_agg(p.id), '{}') into v_kept
    from public.posts p
   where p.owner_id = p_user_id
     and exists (select 1 from public.post_handoffs h
                  where h.post_id = p.id and h.status = 'handed_over'
                    and h.recipient_id is not null and h.recipient_id <> p_user_id);

  -- Every other post of the member goes, as the cascade did.
  delete from public.posts p
   where p.owner_id = p_user_id and p.id <> all (v_kept);
  -- A post of an owner who already left, received only by this member: nobody is left.
  delete from public.posts p
   where p.owner_id is null
     and exists (select 1 from public.post_handoffs h
                  where h.post_id = p.id and h.recipient_id = p_user_id and h.status = 'handed_over')
     and not exists (select 1 from public.post_handoffs h
                      where h.post_id = p.id and h.status = 'handed_over'
                        and h.recipient_id is not null and h.recipient_id <> p_user_id);

  if cardinality(v_kept) = 0 then
    return;
  end if;

  -- What the deleted owner wrote and where they are. Each statement touches only rows that
  -- still differ, so a second run changes nothing.
  update public.posts p
     set title = '—', description = null, location_display_level = 'CityOnly',
         shown_street = null, shown_street_number = null
   where p.id = any (v_kept)
     and (p.title, p.description, p.location_display_level, p.shown_street, p.shown_street_number)
         is distinct from ('—', null, 'CityOnly', null, null);
  delete from public.post_media m where m.post_id = any (v_kept);
  delete from public.post_private_locations l where l.post_id = any (v_kept);
  update public.post_ride_details r
     set origin_street_id = null, dest_street_id = null, meeting_points = '[]'::jsonb, notes = null
   where r.post_id = any (v_kept)
     and (r.origin_street_id, r.dest_street_id, r.meeting_points, r.notes)
         is distinct from (null::integer, null::integer, '[]'::jsonb, null::text);
  update public.post_event_details e set address_label = null
   where e.post_id = any (v_kept) and e.address_label is not null;
  delete from public.post_embeddings x where x.post_id = any (v_kept);
  delete from public.content_translations t
   where t.content_type = 'post' and t.content_id = any (v_kept);
end;
$$;
comment on function kc_private.account_keep_counterpart_records(uuid) is
  'Before a member is deleted: ends their live handoffs, deletes their posts that are nobody else''s record, and strips their text, photos and address from the ones handed over to a member who stays (#2088). Idempotent.';
revoke all on function kc_private.account_keep_counterpart_records(uuid) from public, anon, authenticated;

create function kc_private.users_keep_counterpart_records()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.account_keep_counterpart_records(old.id);
  return old;
end;
$$;
comment on function kc_private.users_keep_counterpart_records() is
  'BEFORE DELETE on public.users: the other members'' records survive the deletion (#2088).';
revoke all on function kc_private.users_keep_counterpart_records() from public, anon, authenticated;

create trigger users_keep_counterpart_records
  before delete on public.users
  for each row
  execute function kc_private.users_keep_counterpart_records();

-- ── 4. Reads accept a post of a deleted owner ───────────────────────────────────────────

alter policy posts_select_handoff_party on public.posts
  using (
    status = any (array['open', 'closed_delivered'])
    and exists (select 1 from public.post_handoffs h
                 where h.post_id = posts.id and h.recipient_id = (select auth.uid())
                   and h.status <> 'cancelled')
    and (posts.owner_id is null
         or exists (select 1 from public.users u where u.id = posts.owner_id)));

-- The card of a post whose owner is NULL: no owner, not masked. The gate of `post_cards`
-- (`post_read_visibility_gate`, #2648) and its worker `kc_access.post_card_rows` joined the
-- owner with an inner join. A post with an owner keeps that join: no card when the caller may
-- not read the owner. Only the users join and its filter change.
create or replace function kc_access.post_card_rows(p_post_ids uuid[])
returns setof public.post_card
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, case when mk.masked then null else p.owner_id end, p.world_slug, p.kind_id, p.post_type, p.direction, p.status, p.visibility,
         p.title, p.description, p.item_subcategory_id, p.details,
         p.city_id, c.name_he, c.name_en, p.location_display_level, p.time_window, p.urgency_level,
         p.expires_at, p.published_at, p.created_at,
         case when mk.masked then null else u.display_name end,
         case when mk.masked then null else u.share_handle end,
         case when mk.masked then null else u.avatar_url end,
         case when mk.masked then null else u.verification_level end,
         media.cover, coalesce(media.n, 0),
         coalesce(s.reactions_count, 0), coalesce(s.comments_count, 0), coalesce(s.shares_count, 0),
         (select r.reaction_type from public.post_reactions r
           where r.post_id = p.id and r.user_id = (select auth.uid())),
         exists (select 1 from public.saved_posts sp
                  where sp.user_id = (select auth.uid()) and sp.post_id = p.id),
         exists (select 1 from public.follows f
                  where f.follower_id = (select auth.uid()) and f.followed_id = p.owner_id)
           and not mk.masked,
         mk.masked,
         p.geo_approx::text, p.source_language, p.status_before_removal,
         p.shown_street, p.shown_street_number,
         (select ch.id from public.challenges ch where ch.post_id = p.id),
         p.source, p.source_platform
    from public.posts p
    cross join lateral (select kc_access.post_actor_masked(p.id, p.owner_id) as masked) mk
    -- A NULL owner is a member who deleted their account (#2088): the card shows no owner.
    left join public.users u on u.id = p.owner_id
    join public.cities c on c.city_id = p.city_id
    left join public.post_stats s on s.post_id = p.id
    left join lateral (
      select count(*)::integer as n,
             (array_agg(kc_access.post_media_json(m) order by m.ordinal))[1] as cover
        from public.post_media m
       where m.post_id = p.id and m.processing_status = 'ready') media on true
   where p.id = any (p_post_ids[1:100]);
$$;

create or replace function public.post_cards(p_post_ids uuid[])
returns setof public.post_card
language sql
stable
security invoker
set search_path = ''
as $$
  -- Row-level security decides here, once: the post's policies and its owner's (a NULL owner
  -- is a member who deleted their account, #2088).
  select c.*
    from kc_access.post_card_rows(array(
           select p.id
             from public.posts p
             left join public.users u on u.id = p.owner_id
            where p.id = any (p_post_ids[1:100])
              and (p.owner_id is null or u.id is not null))) c;
$$;

-- ── 5. Guards that a NULL member must not open ──────────────────────────────────────────
-- Each body is the baseline's; only the comparison with the members changes.

create or replace function public.mark_giving_handed_over(p_handoff_id uuid)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_handoff public.post_handoffs := kc_private.handoff_lock(p_handoff_id);
begin
  if v_user_id is distinct from v_handoff.owner_id and v_user_id is distinct from v_handoff.recipient_id then
    raise exception 'handoff_not_found' using errcode = 'P0001';
  end if;
  if v_handoff.machine_id <> 'giving_handoff' then
    raise exception 'handoff_world_not_supported' using errcode = 'P0001';
  end if;
  if v_handoff.status <> 'confirmed' then
    raise exception 'handoff_not_confirmed' using errcode = 'P0001';
  end if;

  v_handoff := kc_private.handoff_move(
    p_handoff_id, 'handed_over', case v_user_id when v_handoff.owner_id then 'owner' else 'recipient' end);
  perform kc_private.post_close_after_handoff(v_handoff);
  return v_handoff;
end;
$$;

create or replace function public.cancel_giving_handoff(p_handoff_id uuid)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
  v_handoff constant public.post_handoffs := kc_private.handoff_lock(p_handoff_id);
  v_by_owner constant boolean := v_user_id is not distinct from v_handoff.owner_id;
begin
  if (v_user_id is distinct from v_handoff.owner_id and v_user_id is distinct from v_handoff.recipient_id)
     or v_handoff.status not in ('reserved', 'confirmed') then
    raise exception 'handoff_not_found' using errcode = 'P0001';
  end if;
  -- Rides, stays and events cancel through their own RPCs (late-cancel rules, waiting list).
  if v_handoff.machine_id <> 'giving_handoff' then
    raise exception 'handoff_world_not_supported' using errcode = 'P0001';
  end if;

  return kc_private.handoff_move(
    p_handoff_id, 'cancelled',
    case when v_by_owner then 'owner' else 'recipient' end,
    case when not v_by_owner then 'recipient_cancelled'
         when v_handoff.status = 'reserved' then 'declined'
         else 'owner_cancelled' end);
end;
$$;

create or replace function public.confirm_item_handoff(p_handoff_id uuid)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_handoff constant public.post_handoffs := kc_private.handoff_lock(p_handoff_id);
begin
  if v_handoff.owner_id is distinct from v_user_id or v_handoff.status <> 'reserved'
     or v_handoff.machine_id <> 'giving_handoff' then
    raise exception 'handoff_not_found' using errcode = 'P0001';
  end if;
  return kc_private.handoff_move(p_handoff_id, 'confirmed', 'owner');
end;
$$;

create or replace function kc_private.world_handoff_lock(
  p_handoff_id uuid, p_machine text, p_owner_only boolean default false, p_active boolean default true)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := case when p_active then kc_private.require_active_caller()
                                  else kc_private.require_caller() end;
  v_handoff constant public.post_handoffs := kc_private.handoff_lock(p_handoff_id);
begin
  if v_handoff.machine_id <> p_machine
     or (v_user_id is distinct from v_handoff.owner_id and v_user_id is distinct from v_handoff.recipient_id)
     or (p_owner_only and v_user_id is distinct from v_handoff.owner_id) then
    raise exception 'handoff_not_found' using errcode = 'P0001';
  end if;
  return v_handoff;
end;
$$;

create or replace function public.rate_handoff(p_handoff_id uuid, p_stars integer, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_comment constant text := nullif(btrim(p_comment), '');
  v_handoff public.post_handoffs;
  v_ratee_id uuid;
begin
  if p_stars is null or p_stars not between 1 and 5 or char_length(v_comment) > 500 then
    raise exception 'invalid_rating' using errcode = 'P0001';
  end if;
  select h.* into v_handoff from public.post_handoffs h
   where h.id = p_handoff_id and h.status = 'handed_over';
  if not found then
    raise exception 'handoff_not_found' using errcode = 'P0001';
  end if;
  if v_user_id is distinct from v_handoff.owner_id and v_user_id is distinct from v_handoff.recipient_id then
    raise exception 'not_participant' using errcode = 'P0001';
  end if;
  v_ratee_id := case when v_user_id = v_handoff.owner_id then v_handoff.recipient_id else v_handoff.owner_id end;
  -- The other member deleted their account (#2088): there is nobody to rate.
  if v_ratee_id is null then
    raise exception 'counterpart_deleted' using errcode = 'P0001';
  end if;

  insert into public.post_ratings (handoff_id, rater_id, ratee_id, stars, comment)
  values (p_handoff_id, v_user_id, v_ratee_id, p_stars, v_comment)
  on conflict (handoff_id, rater_id) do nothing;
  if not found then
    raise exception 'handoff_already_rated' using errcode = 'P0001';
  end if;

  perform kc_private.outbox_enqueue('karma', jsonb_build_object(
    'kind', 'rating_given', 'handoff_id', p_handoff_id, 'post_id', v_handoff.post_id,
    'rater_id', v_user_id));
end;
$$;

create or replace function public.upsert_post_actor_identity(
  p_post_id uuid, p_surface_visibility text, p_hide_from_counterparty boolean,
  p_identity_visibility text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_post public.posts;
begin
  if p_surface_visibility is null or p_surface_visibility not in ('Public', 'FollowersOnly', 'OnlyMe') then
    raise exception 'invalid_surface_visibility' using errcode = 'P0001';
  end if;
  if p_identity_visibility is not null and p_identity_visibility not in ('Public', 'FollowersOnly', 'Hidden') then
    raise exception 'invalid_identity_visibility' using errcode = 'P0001';
  end if;
  select p.* into v_post from public.posts p where p.id = p_post_id;
  if not found then
    raise exception 'post_not_found' using errcode = 'P0001';
  end if;
  if v_post.owner_id is distinct from v_user_id and not exists (
       select 1 from public.post_handoffs h
        where h.post_id = p_post_id and h.recipient_id = v_user_id and h.status = 'handed_over') then
    raise exception 'not_participant' using errcode = 'P0001';
  end if;
  -- Only a private profile has approved followers to limit a post to (a public one is followed freely).
  if p_surface_visibility = 'FollowersOnly'
     and not exists (select 1 from public.users u where u.id = v_user_id and u.privacy_mode = 'Private') then
    raise exception 'followers_only_requires_private' using errcode = 'P0001';
  end if;

  insert into public.post_actor_identity as i
         (post_id, user_id, surface_visibility, identity_visibility, hide_from_counterparty)
  values (p_post_id, v_user_id, p_surface_visibility, p_identity_visibility,
          coalesce(p_hide_from_counterparty, false))
  on conflict (post_id, user_id) do update
    set surface_visibility = excluded.surface_visibility,
        identity_visibility = coalesce(excluded.identity_visibility, i.identity_visibility),
        hide_from_counterparty = excluded.hide_from_counterparty;

  if v_post.owner_id = v_user_id and v_post.status = 'closed_delivered'
     and v_post.visibility <> p_surface_visibility then
    update public.posts p set visibility = p_surface_visibility where p.id = p_post_id;
  end if;
end;
$$;
