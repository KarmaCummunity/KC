-- 0091_heal_d28_post_actor_identity.sql
-- Heals partial application of 0085 on environments where `schema_migrations`
-- recorded 0085+ but DDL did not fully commit (e.g. missing
-- `participant_closed_surface_visible`, stale `post_actor_identity` columns).
-- Idempotent: safe on fully-up-to-date databases (re-runs CREATE OR REPLACE and
-- IF NOT EXISTS / guarded renames only).
--
-- D-28 / FR-POST-021 — keeps `profile_closed_posts` (0088) working: it calls
-- `participant_closed_surface_visible`, which must exist.

set search_path = public;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Schema: add `surface_visibility`; rename `exposure` → `identity_visibility`.
--    (Identical idempotent steps to migration 0085 §1.)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.post_actor_identity
  add column if not exists surface_visibility text not null default 'Public';

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    where t.relname = 'post_actor_identity'
      and c.conname = 'post_actor_identity_surface_visibility_check'
  ) then
    alter table public.post_actor_identity
      add constraint post_actor_identity_surface_visibility_check
      check (surface_visibility in ('Public', 'FollowersOnly', 'OnlyMe'));
  end if;
end$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'post_actor_identity'
      and column_name  = 'exposure'
  ) then
    alter table public.post_actor_identity rename column exposure to identity_visibility;
  end if;
end$$;

do $$
declare
  v_old_name text;
begin
  select c.conname
    into v_old_name
  from pg_constraint c
  join pg_class t on c.conrelid = t.oid
  where t.relname = 'post_actor_identity'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%exposure%';
  if v_old_name is not null then
    execute format('alter table public.post_actor_identity drop constraint %I', v_old_name);
  end if;
end$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    where t.relname = 'post_actor_identity'
      and c.conname = 'post_actor_identity_identity_visibility_check'
  ) then
    alter table public.post_actor_identity
      add constraint post_actor_identity_identity_visibility_check
      check (identity_visibility in ('Public', 'FollowersOnly', 'Hidden'));
  end if;
end$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SECURITY DEFINER helper + 3. is_post_visible_to (from 0085 §2–3).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.participant_closed_surface_visible(
  p_post   public.posts,
  p_actor  uuid,
  p_viewer uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sv text;
begin
  if p_actor is null then
    return false;
  end if;

  select pai.surface_visibility
    into v_sv
  from public.post_actor_identity pai
  where pai.post_id = p_post.post_id
    and pai.user_id = p_actor
  limit 1;

  if v_sv is null then
    if p_actor = p_post.owner_id then
      v_sv := p_post.visibility::text;
    else
      v_sv := 'Public';
    end if;
  end if;

  return case v_sv
    when 'Public'        then true
    when 'OnlyMe'        then false
    when 'FollowersOnly' then coalesce(public.is_following(p_viewer, p_actor), false)
    else true
  end;
end;
$$;

revoke execute on function public.participant_closed_surface_visible(public.posts, uuid, uuid) from public;
grant  execute on function public.participant_closed_surface_visible(public.posts, uuid, uuid) to authenticated, anon, service_role;

comment on function public.participant_closed_surface_visible(public.posts, uuid, uuid) is
  'D-28 / FR-POST-021 AC3: resolves a participant''s surface_visibility for a viewer. Falls back to posts.visibility for the publisher (preserves owner intent) and to Public for non-publishers. SECURITY DEFINER to break RLS recursion through is_post_visible_to.';

create or replace function public.is_post_visible_to(p_post public.posts, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_post.owner_id = p_viewer then true
    when public.is_blocked(p_viewer, p_post.owner_id) then false
    when exists (
      select 1 from public.reporter_hides h
      where h.reporter_id = p_viewer
        and h.target_type = 'post'
        and h.target_id   = p_post.post_id
    ) then false
    when p_post.status in ('removed_admin','deleted_no_recipient','expired') then false
    when p_post.status = 'closed_delivered' then
      case
        when exists (
          select 1 from public.recipients r
          where r.post_id = p_post.post_id
            and r.recipient_user_id = p_viewer
        ) then true
        when public.participant_closed_surface_visible(p_post, p_post.owner_id, p_viewer) then true
        when exists (
          select 1 from public.recipients r2
          where r2.post_id = p_post.post_id
            and r2.recipient_user_id is not null
            and public.participant_closed_surface_visible(p_post, r2.recipient_user_id, p_viewer)
        ) then true
        else false
      end
    when p_post.status = 'open' and p_post.visibility = 'Public' then true
    when p_post.status = 'open' and p_post.visibility = 'OnlyMe' then false
    when p_post.status = 'open' and p_post.visibility = 'FollowersOnly' then
      public.is_following(p_viewer, p_post.owner_id)
    else false
  end;
$$;

comment on column public.post_actor_identity.surface_visibility is
  'D-28 / FR-POST-021 AC1: per-participant audience for closed-post discovery through this participant''s surface. Public (default) / FollowersOnly (viewer must follow actor) / OnlyMe (third parties never reach via this surface). Owner and active recipient always retain read access regardless.';

comment on column public.post_actor_identity.identity_visibility is
  'D-26 / FR-POST-021 AC1: per-participant identity chrome (renamed from `exposure`). Public (full name/avatar/deeplink to viewers permitted to read the post) / FollowersOnly (anonymous to non-followers) / Hidden (anonymous to all non-self).';

comment on column public.post_actor_identity.hide_from_counterparty is
  'D-26 / FR-POST-021 AC4(a): force anonymous identity to the counterparty on post chrome, regardless of identity_visibility.';
