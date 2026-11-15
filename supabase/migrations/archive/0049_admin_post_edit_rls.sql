-- 0049_admin_post_edit_rls | FR-ADMIN-006 + FR-POST-008 — Super Admin may read
-- and edit any open post (same client update path as owner). Adds owner_id
-- immutability on UPDATE so elevated UPDATE policies cannot reassign ownership.

create or replace function public.posts_forbid_owner_id_change()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'posts_owner_id_is_immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists posts_forbid_owner_id_change_trigger on public.posts;
create trigger posts_forbid_owner_id_change_trigger
  before update on public.posts
  for each row execute function public.posts_forbid_owner_id_change();

-- SELECT: OR-combines with posts_select_visible (permissive default).
drop policy if exists posts_select_super_admin on public.posts;
create policy posts_select_super_admin on public.posts
  for select to authenticated
  using (public.is_admin(auth.uid()));

-- UPDATE: OR-combines with posts_update_self; open posts only (matches edit UX).
drop policy if exists posts_update_super_admin on public.posts;
create policy posts_update_super_admin on public.posts
  for update to authenticated
  using (public.is_admin(auth.uid()) and status = 'open')
  with check (public.is_admin(auth.uid()) and status = 'open');

-- media_assets: allow admin to replace rows for open posts they do not own.
drop policy if exists media_assets_delete_super_admin on public.media_assets;
create policy media_assets_delete_super_admin on public.media_assets
  for delete to authenticated
  using (
    exists (
      select 1
      from public.posts p
      where p.post_id = media_assets.post_id
        and p.status = 'open'
        and public.is_admin(auth.uid())
    )
  );

drop policy if exists media_assets_insert_super_admin on public.media_assets;
create policy media_assets_insert_super_admin on public.media_assets
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.posts p
      where p.post_id = media_assets.post_id
        and p.status = 'open'
        and public.is_admin(auth.uid())
    )
  );
