-- 0151_cascade_post_actor_identity_on_recipient_delete | TD-86
--
-- `post_actor_identity` (0083 / 0085) has no FK to `recipients`. When the
-- credited recipient self-unmarks via `rpc_recipient_unmark_self` (0075) the
-- recipients row is deleted but the matching `post_actor_identity` row stays.
-- The RLS UPDATE policy (`post_actor_identity_update_own_participant`) uses
-- `user_id = auth.uid()`, so the ex-recipient still passes USING; the row
-- can't actually be mutated because the WITH CHECK clause re-asserts the
-- owner-or-recipient guard. Functionally inert, but the stale row distorts:
--   * `participant_closed_surface_visible` would return the ex-recipient's
--     prior `surface_visibility` on any later code path that re-resolves the
--     identity for this (post, user) pair;
--   * a subsequent re-marking of the same user as recipient inherits the
--     old identity preferences instead of starting from the per-pair default.
--
-- Fix: add an AFTER DELETE trigger on `recipients` that nukes the matching
-- `post_actor_identity` row (only the recipient's; the owner's row stays).
-- The TD also called out `ON DELETE CASCADE` as an option, but the FK lives
-- between `post_actor_identity` and `posts/users` — `recipients` would need
-- a composite reference. A trigger is the cleaner, smaller-blast change.

set search_path = public;

create or replace function public.recipients_after_delete_cleanup_actor_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.post_actor_identity
   where post_id = old.post_id
     and user_id = old.recipient_user_id;
  return null;
end;
$$;

drop trigger if exists recipients_after_delete_cleanup_actor_identity on public.recipients;
create trigger recipients_after_delete_cleanup_actor_identity
  after delete on public.recipients
  for each row execute function public.recipients_after_delete_cleanup_actor_identity();

comment on function public.recipients_after_delete_cleanup_actor_identity() is
  'TD-86: when a recipients row is deleted, drop the matching post_actor_identity row so a later re-mark starts clean and visibility helpers do not read stale per-pair state.';

-- ── One-time backfill ────────────────────────────────────────────────────────
-- Remove any orphaned identity rows whose (post_id, user_id) no longer has a
-- recipients backing row AND user is not the post owner. Conservative: only
-- rows for non-owners; owners' identity rows survive without a recipients row
-- by design.
delete from public.post_actor_identity pai
 using public.posts p
 where pai.post_id = p.post_id
   and pai.user_id <> p.owner_id
   and not exists (
     select 1 from public.recipients r
     where r.post_id = pai.post_id
       and r.recipient_user_id = pai.user_id
   );
