-- 0018_fix_counters_by_post_type | Fix items_given / items_received direction
--
-- Original (0006) increments `users.items_given_count` for the post OWNER on
-- every close, and `users.items_received_count` for the marked user on every
-- recipients-row insert — regardless of `posts.type`.
--
-- Correct semantics:
--   * Give post:    owner gives,    marked receives  →  owner +items_given,    marked +items_received
--   * Request post: owner receives, marked gives     →  owner +items_received, marked +items_given
--
-- This migration:
--   1. Replaces `posts_after_change_counters` so the items_given / received
--      branches consult `new.type` (or `old.type` on reopen).
--   2. Replaces `recipients_after_insert_counters` / `_after_delete_counters`
--      so they JOIN to `posts` to read `type` and pick the right column.
--   3. Backfills both counters from current state so existing data lines up.
--
-- The `active_posts_count_*` and `posts_created_total` legs are unchanged —
-- they don't depend on type. We re-CREATE the function whole because plpgsql
-- has no "edit a single branch" facility; the rewrite is the same body as 0006
-- with the type-aware branches replacing the type-agnostic ones.

set search_path = public;

-- ── 1. posts trigger function (full rewrite of the items_given/received legs) ──
create or replace function public.posts_after_change_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_open  boolean;
  v_now_open  boolean;
  v_owner     uuid;
begin
  -- ── INSERT ──────────────────────────────────────────────────────────────
  if tg_op = 'INSERT' then
    update public.users
       set posts_created_total = posts_created_total + 1
     where user_id = new.owner_id;

    if new.status = 'open' then
      update public.users
         set active_posts_count_internal = active_posts_count_internal + 1,
             active_posts_count_public_open = active_posts_count_public_open
               + case when new.visibility = 'Public' then 1 else 0 end,
             active_posts_count_followers_only_open = active_posts_count_followers_only_open
               + case when new.visibility = 'FollowersOnly' then 1 else 0 end
       where user_id = new.owner_id;
    elsif new.status in ('closed_delivered', 'deleted_no_recipient') then
      -- Edge case: post seeded directly in a closed state. Mirror the +1 a
      -- normal open→closed transition would give, but route by `type`.
      if new.type = 'Give' then
        update public.users set items_given_count = items_given_count + 1
         where user_id = new.owner_id;
      else  -- Request
        update public.users set items_received_count = items_received_count + 1
         where user_id = new.owner_id;
      end if;
    end if;
    return null;
  end if;

  -- ── DELETE ──────────────────────────────────────────────────────────────
  if tg_op = 'DELETE' then
    if old.status = 'open' then
      update public.users
         set active_posts_count_internal = public.stats_safe_dec(active_posts_count_internal),
             active_posts_count_public_open = case
               when old.visibility = 'Public'
               then public.stats_safe_dec(active_posts_count_public_open)
               else active_posts_count_public_open
             end,
             active_posts_count_followers_only_open = case
               when old.visibility = 'FollowersOnly'
               then public.stats_safe_dec(active_posts_count_followers_only_open)
               else active_posts_count_followers_only_open
             end
       where user_id = old.owner_id;
    end if;
    return null;
  end if;

  -- ── UPDATE: status / visibility deltas ─────────────────────────────────
  v_owner    := new.owner_id;
  v_was_open := old.status = 'open';
  v_now_open := new.status = 'open';

  -- 3a. Status delta.
  if old.status is distinct from new.status then
    if v_was_open and not v_now_open then
      update public.users
         set active_posts_count_internal = public.stats_safe_dec(active_posts_count_internal),
             active_posts_count_public_open = case
               when old.visibility = 'Public'
               then public.stats_safe_dec(active_posts_count_public_open)
               else active_posts_count_public_open
             end,
             active_posts_count_followers_only_open = case
               when old.visibility = 'FollowersOnly'
               then public.stats_safe_dec(active_posts_count_followers_only_open)
               else active_posts_count_followers_only_open
             end
       where user_id = v_owner;
    elsif v_now_open and not v_was_open then
      update public.users
         set active_posts_count_internal = active_posts_count_internal + 1,
             active_posts_count_public_open = active_posts_count_public_open
               + case when new.visibility = 'Public' then 1 else 0 end,
             active_posts_count_followers_only_open = active_posts_count_followers_only_open
               + case when new.visibility = 'FollowersOnly' then 1 else 0 end
       where user_id = v_owner;
    end if;

    -- items_given / items_received for the OWNER on close ↔ reopen.
    -- Give:    owner gave    → items_given +1 / -1
    -- Request: owner received → items_received +1 / -1
    if v_was_open and new.status in ('closed_delivered', 'deleted_no_recipient') then
      if new.type = 'Give' then
        update public.users set items_given_count = items_given_count + 1
         where user_id = v_owner;
      else
        update public.users set items_received_count = items_received_count + 1
         where user_id = v_owner;
      end if;
    elsif old.status in ('closed_delivered', 'deleted_no_recipient') and v_now_open then
      if old.type = 'Give' then
        update public.users
           set items_given_count = public.stats_safe_dec(items_given_count)
         where user_id = v_owner;
      else
        update public.users
           set items_received_count = public.stats_safe_dec(items_received_count)
         where user_id = v_owner;
      end if;
    end if;
  end if;

  -- 3b. Visibility delta — only meaningful when the post stays in `open`.
  if v_was_open and v_now_open and old.visibility is distinct from new.visibility then
    if old.visibility = 'Public' then
      update public.users
         set active_posts_count_public_open = public.stats_safe_dec(active_posts_count_public_open)
       where user_id = v_owner;
    elsif old.visibility = 'FollowersOnly' then
      update public.users
         set active_posts_count_followers_only_open = public.stats_safe_dec(active_posts_count_followers_only_open)
       where user_id = v_owner;
    end if;

    if new.visibility = 'Public' then
      update public.users
         set active_posts_count_public_open = active_posts_count_public_open + 1
       where user_id = v_owner;
    elsif new.visibility = 'FollowersOnly' then
      update public.users
         set active_posts_count_followers_only_open = active_posts_count_followers_only_open + 1
       where user_id = v_owner;
    end if;
  end if;

  return null;
end;
$$;

-- ── 2. recipients trigger functions — read post.type, route accordingly ────
create or replace function public.recipients_after_insert_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_type text;
begin
  select type into v_post_type from public.posts where post_id = new.post_id;
  if v_post_type = 'Give' then
    update public.users set items_received_count = items_received_count + 1
     where user_id = new.recipient_user_id;
  else  -- Request
    update public.users set items_given_count = items_given_count + 1
     where user_id = new.recipient_user_id;
  end if;
  return null;
end;
$$;

create or replace function public.recipients_after_delete_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_type text;
begin
  -- The post may already be deleted (cascade); guard with default 'Give'
  -- since the historical trigger always touched items_received. If post is
  -- gone, we can't determine type — fall back to items_received -1 to match
  -- pre-0018 behaviour for any orphan paths.
  select type into v_post_type from public.posts where post_id = old.post_id;
  if v_post_type = 'Request' then
    update public.users
       set items_given_count = public.stats_safe_dec(items_given_count)
     where user_id = old.recipient_user_id;
  else  -- Give or unknown
    update public.users
       set items_received_count = public.stats_safe_dec(items_received_count)
     where user_id = old.recipient_user_id;
  end if;
  return null;
end;
$$;

-- ── 3. Backfill ────────────────────────────────────────────────────────────
-- Recompute both counters from current ground truth. Subqueries:
--  • items_given for OWNER:    closed Give posts                     +
--                              recipient rows on Request posts
--  • items_received for OWNER: closed Request posts                  +
--                              recipient rows on Give posts (unchanged shape)
update public.users u set
  items_given_count = (
    select coalesce(count(*), 0) from public.posts p
     where p.owner_id = u.user_id
       and p.status in ('closed_delivered', 'deleted_no_recipient')
       and p.type = 'Give'
  ) + (
    select coalesce(count(*), 0) from public.recipients r
      join public.posts p on p.post_id = r.post_id
     where r.recipient_user_id = u.user_id
       and p.type = 'Request'
  ),
  items_received_count = (
    select coalesce(count(*), 0) from public.posts p
     where p.owner_id = u.user_id
       and p.status in ('closed_delivered', 'deleted_no_recipient')
       and p.type = 'Request'
  ) + (
    select coalesce(count(*), 0) from public.recipients r
      join public.posts p on p.post_id = r.post_id
     where r.recipient_user_id = u.user_id
       and p.type = 'Give'
  );

-- end of 0018_fix_counters_by_post_type
