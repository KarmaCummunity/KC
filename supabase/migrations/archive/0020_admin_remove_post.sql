-- 0020_admin_remove_post | FR-ADMIN-009 (renumbered from 0017 — 0017–0019 taken by main during merge)
-- Super-admin flips Post.status to 'removed_admin' from the post detail screen.
-- Server re-checks is_admin(auth.uid()) — client gating is convenience only.
-- Idempotent: re-running on an already-removed post is a no-op (no extra audit
-- row). Uses the existing audit_events.action value 'manual_remove_target'
-- (defined in 0005_init_moderation.sql), so no schema change is needed.

create or replace function public.admin_remove_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not public.is_admin(v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.posts
     set status = 'removed_admin',
         updated_at = now()
   where post_id = p_post_id
     and status <> 'removed_admin';

  if not found then
    -- Either the post does not exist or it's already in removed_admin.
    -- Treat both as quiet no-ops (idempotent). Audit row is NOT written
    -- in either case to avoid duplicate or orphan audit lines.
    return;
  end if;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'manual_remove_target', 'post', p_post_id, '{}'::jsonb);
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default on new functions; revoke first
-- (PUBLIC includes anon), then grant explicitly to authenticated. Defense in
-- depth: the function body also re-checks is_admin(auth.uid()).
revoke execute on function public.admin_remove_post(uuid) from public;
grant execute on function public.admin_remove_post(uuid) to authenticated;
