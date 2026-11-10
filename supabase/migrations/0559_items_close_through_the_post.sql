-- 0559_items_close_through_the_post.sql | G1 step 3c (ADR-006, D12, D17, D19, D63; gap G34): one
-- closing system for items — the post's closure is the closing truth, and the item karma (with
-- its value bonus) is earned once, through it.
--
-- An item made through the post form (FR-POST-001 AC6) is a post that owns its listing (0243,
-- `posts.listing_id` null). Before this step it had two ways to close, each with its own karma:
--   * the post closure (`close_post_with_recipient`, FR-CLOSURE-*): a `recipients` row, the post
--     goes to `closed_delivered`, `karma_on_post_change` awards giver 20 + value bonus / receiver 15
--     and a reopen reverses it (S20);
--   * the handoff (`mark_giving_handed_over`): the listing closed and `karma_award_handoff` paid
--     giver 20 / receiver 15 — but the item's post stayed `open`, still listed as available, and a
--     later post closure paid the karma a second time.
-- (An item listing created through the marketplace RPC owns a mirror post instead; its post
-- already closes with the listing and only the handoff pays, so it keeps that path.)
--
-- From this step:
--   * handing an item over closes its post through the post closure (recipient row + status), so
--     the §7.6 item values and the bonus are paid once, by the closure, and a reopen reverses them;
--     the hand-over no longer pays handoff karma for items. The recipient is not told twice: the
--     hand-over notice (0528) already reaches both sides, so the "marked as recipient" notice
--     (0063) is skipped for this path;
--   * closing an item post while it has a live handoff settles that handoff: the one to the
--     recorded recipient is handed over, any other is cancelled by the system;
--   * item posts left open after an earlier hand-over are closed once, without karma (it was paid
--     by the handoff), chat closure messages or notifications.
-- Food, rides, knowledge and housing keep their per-handoff karma (D63): a post of those worlds
-- can carry many handoffs, and their post-side karma triggers are items-only since 0554.
-- Additive and idempotent.

begin;

-- ── 1. The hand-over closes an item through its post ─────────────────────────────────────────

-- Closes the post of handoff p_h for its recipient through the post closure: the recipient row,
-- then the status (the karma and chat-message triggers read the row). The listing follows the
-- post (0243 sync); its availability is set here as the hand-over always did.
create or replace function public.post_close_from_handoff(p_h public.post_handoffs)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The hand-over notice (0528) already told the recipient; skip the 0063 "marked" notice.
  perform set_config('kc.closing_from_handoff', 'on', true);
  insert into public.recipients (post_id, recipient_user_id)
  values (p_h.post_id, p_h.recipient_id)
  on conflict (post_id) do update
    set recipient_user_id = excluded.recipient_user_id, marked_at = now();
  perform set_config('kc.closing_from_handoff', '', true);

  update public.posts
     set status = 'closed_delivered', delete_after = null, updated_at = now()
   where post_id = p_h.post_id
     and status = 'open';

  update public.listings
     set status = 'closed', availability_status = 'ongoing', updated_at = now()
   where listing_id = public.listing_id_of_post(p_h.post_id)
     and (status, availability_status) is distinct from ('closed', 'ongoing');
end;
$$;

comment on function public.post_close_from_handoff(public.post_handoffs) is
  'G1 / G34: closes the post of a handed-over item handoff through the post closure (recipient row + closed_delivered), so the item karma and bonus are paid once by the closure.';

revoke all on function public.post_close_from_handoff(public.post_handoffs) from public, anon, authenticated;
grant execute on function public.post_close_from_handoff(public.post_handoffs) to service_role;

drop trigger if exists tg_recipients_enqueue_notifications on public.recipients;
create trigger tg_recipients_enqueue_notifications
  after insert or delete on public.recipients
  for each row
  when (coalesce(current_setting('kc.closing_from_handoff', true), '') <> 'on')
  execute function public.recipients_enqueue_notifications();

-- 0555 body; a post-engine item closes through its post, every other handoff keeps the listing
-- close + handoff karma (a mirror post follows its listing).
create or replace function public.mark_giving_handed_over(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_h public.post_handoffs;
  v_row public.giving_handoffs;
begin
  update public.post_handoffs
     set status = 'handed_over', handed_over_at = now()
   where handoff_id = p_handoff_id
     and status = 'confirmed'
     and (owner_id = auth.uid() or recipient_id = auth.uid())
  returning * into v_h;
  if not found then raise exception 'handoff_not_confirmed' using errcode = '23514'; end if;

  if v_h.world_slug = 'items'
     and exists (select 1 from public.posts p where p.post_id = v_h.post_id and p.listing_id is null) then
    -- One closing system (G34): the post closure pays giver 20 + value bonus / receiver 15 once.
    perform public.post_close_from_handoff(v_h);
  else
    update public.listings
       set status = 'closed', availability_status = 'ongoing', updated_at = now()
     where listing_id = public.listing_id_of_post(v_h.post_id);
    perform public.karma_award_handoff(v_h.owner_id, v_h.recipient_id, v_h.world_slug, p_handoff_id);
  end if;

  select * into v_row from public.giving_handoffs where handoff_id = p_handoff_id;
  return v_row;
end;
$$;

revoke all on function public.mark_giving_handed_over(uuid) from public, anon;
grant execute on function public.mark_giving_handed_over(uuid) to authenticated;

-- ── 2. Closing an item post settles its live handoffs ─────────────────────────────────────────

create or replace function public.posts_settle_handoffs_on_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
begin
  select r.recipient_user_id into v_recipient from public.recipients r where r.post_id = new.post_id;
  -- The member the owner marked received the item.
  update public.post_handoffs
     set status = 'handed_over', handed_over_at = now(), confirmed_at = coalesce(confirmed_at, now())
   where post_id = new.post_id
     and status in ('reserved', 'confirmed')
     and recipient_id = v_recipient;
  -- Anyone else waiting for it will not get it.
  update public.post_handoffs
     set status = 'cancelled', cancelled_at = now(), cancel_reason = 'system'
   where post_id = new.post_id
     and status in ('reserved', 'confirmed');
  return null;
end;
$$;

revoke all on function public.posts_settle_handoffs_on_close() from public, anon, authenticated;

drop trigger if exists posts_settle_handoffs_on_close on public.posts;
create trigger posts_settle_handoffs_on_close
  after update of status on public.posts
  for each row
  when (new.listing_id is null and new.world_slug = 'items'
        and new.status = 'closed_delivered' and old.status is distinct from 'closed_delivered')
  execute function public.posts_settle_handoffs_on_close();

-- ── 3. Item posts left open after an earlier hand-over close once, quietly ───────────────────

-- Their karma was paid by the handoff (0453), so the closure karma, the chat closure messages and
-- the recipient notice are off for this one-off repair.
alter table public.posts disable trigger karma_posts_after_status_update;
alter table public.posts disable trigger posts_after_update_emit_closure_messages;
alter table public.recipients disable trigger tg_recipients_enqueue_notifications;

do $$
declare
  h public.post_handoffs;
  v_n int := 0;
begin
  for h in
    select distinct on (t.post_id) t.*
      from public.post_handoffs t
      join public.posts p on p.post_id = t.post_id
     where t.world_slug = 'items'
       and t.status = 'handed_over'
       and p.world_slug = 'items' and p.listing_id is null and p.status = 'open'
       and not exists (select 1 from public.post_handoffs l
                        where l.post_id = t.post_id and l.status in ('reserved', 'confirmed'))
     order by t.post_id, t.handed_over_at desc
  loop
    insert into public.recipients (post_id, recipient_user_id)
    values (h.post_id, h.recipient_id)
    on conflict (post_id) do nothing;
    update public.posts
       set status = 'closed_delivered', delete_after = null, updated_at = now()
     where post_id = h.post_id and status = 'open';
    v_n := v_n + 1;
  end loop;
  raise notice '0559: % item post(s) closed after an earlier hand-over', v_n;
end $$;

alter table public.posts enable trigger karma_posts_after_status_update;
alter table public.posts enable trigger posts_after_update_emit_closure_messages;
alter table public.recipients enable trigger tg_recipients_enqueue_notifications;

commit;
