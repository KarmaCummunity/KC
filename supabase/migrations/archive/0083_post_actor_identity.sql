-- 0083_post_actor_identity.sql
-- Design: docs/superpowers/specs/2026-05-16-post-actor-privacy-design.md
-- FR-POST-021 — per-actor identity exposure on a post (server-enforced reads via RLS).

set search_path = public;

create table if not exists public.post_actor_identity (
  post_id uuid not null references public.posts (post_id) on delete cascade,
  user_id uuid not null references public.users (user_id) on delete cascade,
  exposure text not null check (exposure in ('Public', 'FollowersOnly', 'Hidden')),
  hide_from_counterparty boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists post_actor_identity_user_idx
  on public.post_actor_identity (user_id);

alter table public.post_actor_identity enable row level security;

create policy post_actor_identity_select_post_visible
  on public.post_actor_identity for select
  using (
    auth.uid() is not null
    and exists (
      select 1 from public.posts p
      where p.post_id = post_actor_identity.post_id
        and public.is_post_visible_to(p, auth.uid())
    )
  );

create policy post_actor_identity_insert_participant
  on public.post_actor_identity for insert
  with check (
    user_id = auth.uid()
    and (
      exists (
        select 1 from public.posts p
        where p.post_id = post_actor_identity.post_id
          and p.owner_id = auth.uid()
      )
      or exists (
        select 1 from public.recipients r
        where r.post_id = post_actor_identity.post_id
          and r.recipient_user_id = auth.uid()
      )
    )
  );

create policy post_actor_identity_update_own_participant
  on public.post_actor_identity for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (
      exists (
        select 1 from public.posts p
        where p.post_id = post_actor_identity.post_id
          and p.owner_id = auth.uid()
      )
      or exists (
        select 1 from public.recipients r
        where r.post_id = post_actor_identity.post_id
          and r.recipient_user_id = auth.uid()
      )
    )
  );

grant select, insert, update on public.post_actor_identity to authenticated;
