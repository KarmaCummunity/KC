-- Organizations · posts of an organization (FR-ORG-007, D22, D31, D91; design §12.1)
--
-- `posts.beneficiary_org_id` names the organization a post is published for. This file
-- closes the foreign keys earlier modules left open, decides who may publish for an
-- organization, and gives the administrators of an organization (org_admin, org_manager)
-- the right to edit and delete its posts. The owner's and the super admin's rights are
-- unchanged.

-- Removing an organization releases its posts to their owners.
alter table public.posts
  add constraint posts_beneficiary_org_fk
  foreign key (beneficiary_org_id) references public.organizations (id) on delete set null;
-- Posts of an organization, newest first: its page, its administrators' list, the foreign key.
create index posts_beneficiary_org_idx on public.posts (beneficiary_org_id, created_at desc, id desc)
  where beneficiary_org_id is not null;

-- A self-declared affiliation (D110) names a registered organization; every registered
-- organization is verified (D53). The row has no meaning without its organization. Index:
-- user_profile_fields_affiliated_org_idx (social graph module).
alter table public.user_profile_fields
  add constraint user_profile_fields_affiliated_org_fk
  foreign key (affiliated_org_id) references public.organizations (id) on delete cascade;

-- ── Publishing for an organization ──────────────────────────────────────────
-- Whoever writes the column — a plain insert, a world's create RPC, the RPC below — a
-- signed-in caller may name only an organization they may publish for (`org.act_as`).
-- Server code without a member session (imports, jobs) is not restricted.
create function kc_private.posts_guard_beneficiary_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not kc_private.can_act_as_org(new.beneficiary_org_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger posts_guard_beneficiary_org_insert
  before insert on public.posts
  for each row when (new.beneficiary_org_id is not null)
  execute function kc_private.posts_guard_beneficiary_org();
create trigger posts_guard_beneficiary_org_update
  before update of beneficiary_org_id on public.posts
  for each row when (new.beneficiary_org_id is not null and new.beneficiary_org_id is distinct from old.beneficiary_org_id)
  execute function kc_private.posts_guard_beneficiary_org();

-- A member may create a post directly in an organization's name; the trigger decides.
grant insert (beneficiary_org_id) on public.posts to authenticated;

-- Replaces the authorization of every post management action (publish, pause, resume,
-- delete, close, reopen): the owner, the super admin, or an administrator of the post's
-- organization (design §12.1).
create or replace function kc_private.can_manage_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.posts p
     where p.id = p_post_id
       and (p.owner_id = (select auth.uid())
            or kc_access.has_admin_role('super_admin')
            or p.beneficiary_org_id = any (kc_access.managed_org_ids())));
$$;
comment on function kc_private.can_manage_post(uuid) is
  'Authorization of every post management action: the owner, the super admin, or an administrator of the post''s organization.';

-- Attaches a post to an organization, or detaches it with null. The caller must manage
-- the post and, to attach, may publish for the organization.
-- Errors: post_not_found (P0001), forbidden (42501).
create function public.set_post_organization(p_post_id uuid, p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.post_lock_managed(p_post_id);
  update public.posts p set beneficiary_org_id = p_org_id where p.id = p_post_id;
end;
$$;
comment on function public.set_post_organization(uuid, uuid) is
  'Publishes an existing post in the name of an organization the caller may act for, or detaches it.';
grant execute on function public.set_post_organization(uuid, uuid) to authenticated;

-- ── Editing ─────────────────────────────────────────────────────────────────
-- May the caller edit the content of a post that is not their own? The super admin: every
-- post, in any status. An administrator of the post's organization: while the content is
-- editable (draft, open, paused — the owner's own rule, D104). One predicate for `posts`
-- and every detail table. Definer rights: it must see the post whatever its audience.
create function kc_access.can_edit_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.posts p
     where p.id = p_post_id
       and (kc_access.has_admin_role('super_admin')
            or (p.status in ('draft', 'open', 'paused')
                and p.beneficiary_org_id = any (kc_access.managed_org_ids()))));
$$;
comment on function kc_access.can_edit_post(uuid) is
  'Policy predicate: the caller edits this post as super admin or as an administrator of its organization.';
grant execute on function kc_access.can_edit_post(uuid) to authenticated;

-- The administrators read every post of their organization, whatever its status or audience.
create policy posts_select_org_admin on public.posts
  for select to authenticated
  using (beneficiary_org_id = any ((select kc_access.managed_org_ids())::uuid[]));
-- Which columns is decided by the grants of each table; status still moves through RPCs.
create policy posts_update_editor on public.posts
  for update to authenticated
  using (kc_access.can_edit_post(id)) with check (kc_access.can_edit_post(id));
create policy post_ride_details_update_editor on public.post_ride_details
  for update to authenticated
  using (kc_access.can_edit_post(post_id)) with check (kc_access.can_edit_post(post_id));
create policy post_housing_details_update_editor on public.post_housing_details
  for update to authenticated
  using (kc_access.can_edit_post(post_id)) with check (kc_access.can_edit_post(post_id));
create policy post_event_details_update_editor on public.post_event_details
  for update to authenticated
  using (kc_access.can_edit_post(post_id)) with check (kc_access.can_edit_post(post_id));
create policy post_food_details_update_editor on public.post_food_details
  for update to authenticated
  using (kc_access.can_edit_post(post_id)) with check (kc_access.can_edit_post(post_id));
-- Bookable times of a knowledge post: an editor adds, changes and removes them like the giver.
create policy post_knowledge_slots_insert_editor on public.post_knowledge_slots
  for insert to authenticated
  with check (kc_access.can_edit_post(post_id));
create policy post_knowledge_slots_update_editor on public.post_knowledge_slots
  for update to authenticated
  using (kc_access.can_edit_post(post_id)) with check (kc_access.can_edit_post(post_id));
create policy post_knowledge_slots_delete_editor on public.post_knowledge_slots
  for delete to authenticated
  using (kc_access.can_edit_post(post_id));

-- ── Directory of verified nonprofits (money hub; FR-ORG-010 AC2) ────────────
-- Active verified nonprofits by name, for signed-in members; the platform organization is
-- not listed. Keyset: pass the name and id of the last row. Runs with the caller's rights.
create function public.list_verified_nonprofits(
  p_limit integer default 50,
  p_after_name text default null,
  p_after_id uuid default null
)
returns table (id uuid, slug text, name text, tagline_he text, tagline_en text, verification_level smallint)
language sql
stable
set search_path = ''
as $$
  select o.id, o.slug, o.name, o.public_tagline_he, o.public_tagline_en, o.verification_level
    from public.organizations o
   where o.is_verified_nonprofit and o.status = 'active' and not o.is_platform
     and (p_after_name is null or (o.name, o.id) > (p_after_name, p_after_id))
   order by o.name, o.id
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;
comment on function public.list_verified_nonprofits(integer, text, uuid) is
  'Verified nonprofits that may receive donations, by name (keyset).';
grant execute on function public.list_verified_nonprofits(integer, text, uuid) to authenticated;
