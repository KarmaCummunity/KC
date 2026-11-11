-- 0092_post_actor_identity_public_chrome.sql
-- D-30 / FR-POST-021: MVP UI no longer exposes per-participant identity_visibility
-- (FollowersOnly/Hidden chrome). Normalize stored chrome to Public so projection
-- matches the product rule: audience via posts.visibility + surface_visibility;
-- identity masking only via hide_from_counterparty (+ D-26 OnlyMe coupling).

set search_path = public;

update public.post_actor_identity
set identity_visibility = 'Public'
where identity_visibility is distinct from 'Public';
