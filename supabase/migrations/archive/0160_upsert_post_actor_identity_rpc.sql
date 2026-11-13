-- 0160_upsert_post_actor_identity_rpc | FR-POST-021 / TD-85 follow-up
--
-- PostgREST `.upsert()` on `post_actor_identity` fails with HTTP 403 after
-- migration 0159 narrowed UPDATE grants to (surface_visibility,
-- identity_visibility, hide_from_counterparty). PostgREST generates
-- ON CONFLICT DO UPDATE SET including PK columns the role cannot update.
--
-- Fix: atomic INSERT … ON CONFLICT DO UPDATE via SECURITY INVOKER RPC that
-- only mutates the user-editable columns. RLS policies on the table still
-- apply; participant guard mirrors insert/update policies.

set search_path = public;

create or replace function public.upsert_post_actor_identity(
  p_post_id uuid,
  p_surface_visibility text,
  p_hide_from_counterparty boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_surface_visibility not in ('Public', 'FollowersOnly', 'OnlyMe') then
    raise exception 'invalid_surface_visibility' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.posts p
    where p.post_id = p_post_id
      and p.owner_id = v_user_id
  )
  and not exists (
    select 1
    from public.recipients r
    where r.post_id = p_post_id
      and r.recipient_user_id = v_user_id
  ) then
    raise exception 'forbidden_not_participant' using errcode = '42501';
  end if;

  insert into public.post_actor_identity (
    post_id,
    user_id,
    surface_visibility,
    identity_visibility,
    hide_from_counterparty
  )
  values (
    p_post_id,
    v_user_id,
    p_surface_visibility,
    'Public',
    p_hide_from_counterparty
  )
  on conflict (post_id, user_id) do update set
    surface_visibility = excluded.surface_visibility,
    identity_visibility = excluded.identity_visibility,
    hide_from_counterparty = excluded.hide_from_counterparty;
end;
$$;

revoke all on function public.upsert_post_actor_identity(uuid, text, boolean) from public;
grant execute on function public.upsert_post_actor_identity(uuid, text, boolean) to authenticated;

comment on function public.upsert_post_actor_identity(uuid, text, boolean) is
  'FR-POST-021: upsert caller''s post_actor_identity row without PostgREST upsert PK-column grant failure (0160 / TD-85 follow-up).';
