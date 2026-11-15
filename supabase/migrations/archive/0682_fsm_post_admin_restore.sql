-- 0682_fsm_post_admin_restore — wave 1b-i of docs/architecture/state-machines.md (#1989):
-- moderation removal and restore of a post follow one rule.
--
-- D129 (PM, 2026-11-09): an admin restore returns a removed
-- post to the status it had before the removal (open, paused, delivered, closed without
-- recipient, or expired), not always to `open`. A post hidden for review was always `open`
-- before it was hidden (both auto-hide writers filter on `status = 'open'`), so it returns
-- to `open`.
--
-- 1. Machine `post`: four restore edges out of `removed_admin` (paused, closed_delivered,
--    deleted_no_recipient, expired). Full delete + re-insert, per design spec §4.1.
-- 2. `posts.status_before_admin_removal` accepts every status a post can be removed from,
--    so `admin_remove_listing` no longer fails on a paused or expired post.
-- 3. `admin_remove_post` removes a post in any status; it no longer silently skips paused
--    and expired posts. `admin_remove_listing` writes the post directly and saves its status
--    (since 0667 `listings` is a view over `posts`, and updating the view lost the status).
-- 4. `admin_restore_target` restores to the saved status and clears it. It no longer
--    "restores" a paused post that was never removed, and drops a branch on a
--    `moderation_status` value the column cannot hold.

begin;

-- ── 1. Catalog: machine `post` with the restore edges ──────────────────────────
delete from public.fsm_edge where machine_id = 'post';
delete from public.fsm_state where machine_id = 'post';

insert into public.fsm_state (machine_id, status) values
  ('post', 'open'),
  ('post', 'closed_delivered'),
  ('post', 'deleted_no_recipient'),
  ('post', 'expired'),
  ('post', 'removed_admin'),
  ('post', 'hidden_pending_review'),
  ('post', 'paused');

insert into public.fsm_edge (machine_id, from_status, to_status, role) values
  ('post', 'open', 'paused', ''),
  ('post', 'open', 'closed_delivered', ''),
  ('post', 'open', 'deleted_no_recipient', ''),
  ('post', 'open', 'expired', ''),
  ('post', 'open', 'removed_admin', ''),
  ('post', 'open', 'hidden_pending_review', ''),
  ('post', 'paused', 'open', ''),
  ('post', 'paused', 'deleted_no_recipient', ''),
  ('post', 'paused', 'expired', ''),
  ('post', 'paused', 'removed_admin', ''),
  ('post', 'paused', 'hidden_pending_review', ''),
  ('post', 'closed_delivered', 'open', ''),
  ('post', 'closed_delivered', 'deleted_no_recipient', ''),
  ('post', 'closed_delivered', 'removed_admin', ''),
  ('post', 'closed_delivered', 'hidden_pending_review', ''),
  ('post', 'expired', 'deleted_no_recipient', ''),
  ('post', 'expired', 'removed_admin', ''),
  ('post', 'expired', 'hidden_pending_review', ''),
  ('post', 'hidden_pending_review', 'open', ''),
  ('post', 'hidden_pending_review', 'closed_delivered', ''),
  ('post', 'hidden_pending_review', 'deleted_no_recipient', ''),
  ('post', 'hidden_pending_review', 'removed_admin', ''),
  ('post', 'deleted_no_recipient', 'open', ''),
  ('post', 'deleted_no_recipient', 'removed_admin', ''),
  ('post', 'removed_admin', 'open', ''),
  ('post', 'removed_admin', 'paused', ''),
  ('post', 'removed_admin', 'closed_delivered', ''),
  ('post', 'removed_admin', 'deleted_no_recipient', ''),
  ('post', 'removed_admin', 'expired', '');

-- ── 2. The saved pre-removal status covers every removable status ──────────────
-- `hidden_pending_review` is saved as `open` (it is only ever entered from `open`), and
-- `removed_admin` cannot be its own predecessor.
alter table public.posts drop constraint if exists posts_status_before_admin_removal_check;
alter table public.posts add constraint posts_status_before_admin_removal_check check (
  status_before_admin_removal is null
  or status_before_admin_removal in ('open', 'paused', 'closed_delivered', 'deleted_no_recipient', 'expired')
);

-- ── 3. admin_remove_post: any status except already removed ────────────────────
create or replace function public.admin_remove_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator']);

  update public.posts
     -- A post hidden for review was open before it was hidden.
     set status_before_admin_removal = case when status = 'hidden_pending_review' then 'open' else status end,
         status = 'removed_admin',
         updated_at = now()
   where post_id = p_post_id
     and status <> 'removed_admin';

  if not found then
    -- Already removed or missing: a quiet no-op keeps the idempotency contract (no audit row).
    return;
  end if;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'manual_remove_target', 'post', p_post_id, '{}'::jsonb);
end;
$$;

revoke all on function public.admin_remove_post(uuid) from public, anon;
grant execute on function public.admin_remove_post(uuid) to authenticated;

-- ── 3b. admin_remove_listing: save the previous status on the post ─────────────
-- Since 0667 `listings` is a view over `posts`; the 0666 body updated the view first, which
-- moved the post to `removed_admin` without saving its status, so a later restore could
-- not return it. The removal now writes the post directly.
create or replace function public.admin_remove_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator']);

  update public.posts
     -- A post hidden for review was open before it was hidden.
     set status_before_admin_removal = case when status = 'hidden_pending_review' then 'open' else status end,
         status = 'removed_admin',
         updated_at = now()
   where (listing_id = p_listing_id or legacy_listing_id = p_listing_id or post_id = p_listing_id)
     and status <> 'removed_admin';

  if not found then
    -- Already removed or missing: a quiet no-op keeps the idempotency contract (no audit row).
    return;
  end if;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'manual_remove_target', 'listing', p_listing_id, '{}'::jsonb);
end;
$$;

revoke all on function public.admin_remove_listing(uuid) from public, anon;
grant execute on function public.admin_remove_listing(uuid) to authenticated;

-- ── 4. admin_restore_target: back to the status before the removal ─────────────
-- The status a restored post returns to: its saved pre-removal status, `open` for a post
-- hidden for review, and `open` for a legacy row removed before 0097 saved the status.
create or replace function kc_private.post_restore_status(p_post public.posts)
returns text
language sql
immutable
as $$
  select case
    when p_post.status = 'removed_admin' then coalesce(p_post.status_before_admin_removal, 'open')
    else 'open'
  end;
$$;

comment on function kc_private.post_restore_status(public.posts) is
  'The status admin_restore_target returns a removed or hidden post to (D129).';

revoke all on function kc_private.post_restore_status(public.posts) from public, anon, authenticated;
grant execute on function kc_private.post_restore_status(public.posts) to service_role;

create or replace function public.admin_restore_target(p_target_type text, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_actor     uuid := auth.uid();
  v_changed   boolean := false;
  v_reporters uuid[];
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator']);

  if p_target_type not in ('post','user','chat','listing') then
    raise exception 'invalid_target_type' using errcode = 'P0010';
  end if;

  if p_target_type = 'post' then
    if not exists (select 1 from public.posts where post_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'post';
    end if;
  elsif p_target_type = 'user' then
    if not exists (select 1 from public.users where user_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'user';
    end if;
  elsif p_target_type = 'chat' then
    if not exists (select 1 from public.chats where chat_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'chat';
    end if;
  elsif p_target_type = 'listing' then
    if not exists (select 1 from public.listings where listing_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'listing';
    end if;
  end if;

  if p_target_type = 'post' then
    -- Only a removed or hidden post is restored; any other status is a no-op.
    update public.posts p
       set status = kc_private.post_restore_status(p),
           status_before_admin_removal = null,
           moderation_status = 'published',
           updated_at = now()
     where p.post_id = p_target_id
       and p.status in ('removed_admin', 'hidden_pending_review');
    v_changed := found;
  elsif p_target_type = 'user' then
    if exists (select 1 from public.users
               where user_id = p_target_id
                 and account_status not in ('suspended_admin','active')) then
      raise exception 'invalid_restore_state'
        using errcode = 'P0011', detail = 'user not in suspended_admin state';
    end if;
    update public.users set account_status = 'active'
     where user_id = p_target_id and account_status = 'suspended_admin';
    v_changed := found;
  elsif p_target_type = 'chat' then
    update public.chats set removed_at = null
     where chat_id = p_target_id and removed_at is not null;
    v_changed := found;
  elsif p_target_type = 'listing' then
    -- Since 0667 `listings` is a view over `posts` (listing_id = post_id), so restoring the
    -- post restores the listing; legacy mirror posts are matched by their listing columns.
    update public.posts p
       set status = kc_private.post_restore_status(p),
           status_before_admin_removal = null,
           updated_at = now()
     where (p.listing_id = p_target_id or p.legacy_listing_id = p_target_id or p.post_id = p_target_id)
       and p.status in ('removed_admin', 'hidden_pending_review');
    v_changed := found;
  end if;

  if not v_changed then return; end if;

  select coalesce(array_agg(distinct reporter_id order by reporter_id), array[]::uuid[])
    into v_reporters
    from public.reports
   where target_type = p_target_type
     and target_id   = p_target_id
     and status      = 'open';

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'restore_target', p_target_type, p_target_id,
          jsonb_build_object('distinct_reporters', to_jsonb(v_reporters)));
end;
$$;

revoke all on function public.admin_restore_target(text, uuid) from public, anon;
grant execute on function public.admin_restore_target(text, uuid) to authenticated;

commit;
