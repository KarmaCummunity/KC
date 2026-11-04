-- 0562_listing_notifications_open_the_post | G1 step 4c (ADR-006, D-220): one detail screen —
-- a notification about a listing opens the listing's post.
--
-- Every notification about a listing (food expiry, ride bookings and routes, item / food
-- handoffs, housing stays) is written with `data.params.listingId` and a route to the listing
-- detail. Since 0557 every published listing has a post, and since step 4a that post is the one
-- detail screen. A BEFORE INSERT trigger on the outbox resolves the listing's post once, when the
-- notification is written, and adds it to the payload:
--   * `params.postId` — read by the push tap allowlist, which opens `/post/[id]`;
--   * `route = '/post/[id]'` and `params.id` — read by the in-app notification center.
-- `params.listingId` is kept, so an app build that predates this still opens the listing route,
-- which forwards to the post (step 4a). A listing without a post (not yet published) keeps its
-- payload unchanged. The writers of each kind stay as they are: one place covers every kind, now
-- and later, until step 6 writes post ids at the source.
--
-- BEFORE triggers fire before AFTER triggers, so the inbox copy (tg_notification_inbox_sync,
-- 0255) and the push dispatcher both see the post route. No existing row is rewritten: an older
-- notification keeps its listing route, which forwards to the post.

create or replace function public.notification_listing_post_route()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing_ref text := new.data #>> '{params,listingId}';
  v_post_id uuid;
begin
  -- Only a well-formed listing id is resolved; anything else is left for the app to reject.
  if v_listing_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return new;
  end if;

  v_post_id := public.post_id_of_listing(v_listing_ref::uuid);
  if v_post_id is null then
    return new;
  end if;

  new.data := new.data || jsonb_build_object(
    'route', '/post/[id]',
    'params', (new.data -> 'params') || jsonb_build_object('postId', v_post_id::text, 'id', v_post_id::text));
  return new;
end;
$$;

revoke all on function public.notification_listing_post_route() from public, anon, authenticated;

comment on function public.notification_listing_post_route() is
  'G1 step 4c (0562): a notification about a listing names the listing''s post (params.postId, '
  'route /post/[id]) so a tap opens the one detail screen.';

drop trigger if exists notifications_outbox_listing_post_route on public.notifications_outbox;
create trigger notifications_outbox_listing_post_route
  before insert on public.notifications_outbox
  for each row
  when (new.data #>> '{params,listingId}' is not null)
  execute function public.notification_listing_post_route();
