-- 0202_post_actor_identity_guest_visible | TD-81
--
-- Problem:
--   The SELECT policy `post_actor_identity_select_post_visible` (lineage 0085 →
--   0092) was gated on `(auth.uid() IS NOT NULL) AND is_post_visible_to(...)`.
--   For a guest (anon, auth.uid() = NULL) the policy returns ZERO rows, so the
--   actor-identity map comes back empty and `applyPostActorIdentityProjection`
--   falls back to its default (Public) exposure. There is no live leak today
--   (the guest preview caps at 3 Public posts and doesn't call the projection),
--   but any future guest surface that renders the projection would expose an
--   identity the participant chose to hide.
--
-- Fix:
--   Drop the `auth.uid() IS NOT NULL` prefix so visibility is governed purely by
--   `is_post_visible_to(p, auth.uid())` — the canonical visibility gate. With a
--   NULL viewer that function already returns true ONLY for guest-visible posts
--   (open + Public; OnlyMe/FollowersOnly/closed/removed → false), so a guest can
--   read an actor-identity row exactly when it can see the post itself. This is
--   the same gate `media_assets` already uses for anon (cleared by the
--   2026-06-14 audit), so the projection now resolves correctly for guests with
--   no over-exposure.
--
-- Mapped to spec: FR-POST-021 (post actor identity), FR-AUTH-014 (guest
--   preview). No new ACs.

set search_path = public;

drop policy if exists post_actor_identity_select_post_visible on public.post_actor_identity;
create policy post_actor_identity_select_post_visible
  on public.post_actor_identity
  for select
  using (
    exists (
      select 1
      from public.posts p
      where p.post_id = post_actor_identity.post_id
        and public.is_post_visible_to(p.*, auth.uid())
    )
  );
