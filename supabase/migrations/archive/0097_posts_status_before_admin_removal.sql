-- 0097_posts_status_before_admin_removal | FR-ADMIN-002 / FR-MOD-006
-- Persist the pre-removal lifecycle status when a post transitions to
-- `removed_admin`, so Super Admin restore can return the row to its prior state.
--
-- Idempotent: safe for `supabase db reset` and for environments where this
-- migration was already applied remotely before the SQL file landed in git.

alter table public.posts
  add column if not exists status_before_admin_removal text;

do $body$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.posts'::regclass
      and c.conname = 'posts_status_before_admin_removal_check'
  ) then
    alter table public.posts
      add constraint posts_status_before_admin_removal_check
      check (
        status_before_admin_removal is null
        or status_before_admin_removal in (
          'open',
          'closed_delivered',
          'deleted_no_recipient'
        )
      );
  end if;
end;
$body$;

-- Manual admin removal: snapshot prior lifecycle status for future restore UX / logic.
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
     set status_before_admin_removal = status,
         status = 'removed_admin',
         updated_at = now()
   where post_id = p_post_id
     and status <> 'removed_admin'
     and status in ('open', 'closed_delivered', 'deleted_no_recipient');

  if not found then
    -- Either the post does not exist, is already removed_admin, or is in a
    -- terminal state (expired) we don't admin-remove. Quiet no-op preserves
    -- legacy idempotency contract.
    return;
  end if;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'manual_remove_target', 'post', p_post_id, '{}'::jsonb);
end;
$$;
