-- 0152_post_actor_identity_updated_at_server_only | TD-85
--
-- `post_actor_identity.updated_at` was included in the table-wide UPDATE grant
-- to `authenticated` (0083 §grant); the FE adapter
-- (`postActorIdentityMethods.upsertPostActorIdentityRow`) stamped it with a
-- client-side `new Date().toISOString()`. Same class of defect as the 0070
-- closures on `posts.reopen_count` and `reports.resolved_at` — server-stamped
-- columns must not be client-writable.
--
-- Fix:
--   1. Add the `set_updated_at` BEFORE UPDATE trigger (same shape as 0002's
--      posts_set_updated_at) so server stamps `updated_at` on every UPDATE.
--   2. Revoke the table-wide UPDATE grant and re-grant column-by-column with
--      only the user-editable columns. `updated_at` is excluded; `post_id` /
--      `user_id` are the primary key and should never be UPDATE'd.
--   3. Companion FE change ships in the same PR: adapter stops sending the
--      `updated_at` field on upsert (INSERT path still gets the column default;
--      UPDATE path is stamped by the trigger).

set search_path = public;

drop trigger if exists post_actor_identity_set_updated_at on public.post_actor_identity;
create trigger post_actor_identity_set_updated_at
  before update on public.post_actor_identity
  for each row execute function public.set_updated_at();

revoke update on public.post_actor_identity from authenticated;
grant update (surface_visibility, identity_visibility, hide_from_counterparty)
  on public.post_actor_identity to authenticated;

comment on trigger post_actor_identity_set_updated_at on public.post_actor_identity is
  'TD-85: server-stamp `updated_at` on every UPDATE; the column was previously client-writable via the table-wide grant.';
