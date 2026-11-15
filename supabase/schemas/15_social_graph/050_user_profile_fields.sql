-- Social graph · user_profile_fields (D109, D110, FR-PROFILE-007 AC8/AC9)
--
-- Optional profile fields, one row per member and field, each with its own visibility.
-- The table belongs to the profile, but lives in this module because who may read a field
-- depends on the follow graph.

create table public.user_profile_fields (
  user_id           uuid not null references public.users (id) on delete cascade,
  -- interests: giving worlds and item subcategories the member cares about
  -- help_tags: what the member can help with (giving-world tags)
  -- affiliated_org: a self-declared affiliation; a label only, it grants no role
  field_key         text not null check (field_key in ('interests', 'help_tags', 'affiliated_org')),
  -- Who may read the field. Left empty on insert, it follows the owner's privacy mode at
  -- that moment: everyone on a public profile, followers on a private one.
  visibility        text not null check (visibility in ('everyone', 'followers', 'only_me')),
  -- Value of the two tag fields: 1 to 50 slugs.
  tags              text[] check (
                      cardinality(tags) between 1 and 50
                      and array_to_string(tags, ' ', '') ~ '^[a-z0-9_.:-]{1,64}( [a-z0-9_.:-]{1,64})*$'),
  -- Value of affiliated_org. The organizations module adds the foreign key and restricts
  -- it to verified organizations.
  affiliated_org_id uuid,
  updated_at        timestamptz not null default now(),
  primary key (user_id, field_key),
  constraint user_profile_fields_value_chk check (
    case when field_key = 'affiliated_org'
      then affiliated_org_id is not null and tags is null
      else tags is not null and affiliated_org_id is null
    end)
);
comment on table public.user_profile_fields is
  'Optional profile fields with per-field visibility. A missing row means the field is not filled in.';

-- Members affiliated with an organization (organization page; future foreign key).
create index user_profile_fields_affiliated_org_idx
  on public.user_profile_fields (affiliated_org_id) where affiliated_org_id is not null;

-- Applies the default visibility. Runs with the caller's rights: the owner can always read
-- their own profile row.
create function kc_private.user_profile_fields_default_visibility()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select case u.privacy_mode when 'Private' then 'followers' else 'everyone' end
    into new.visibility
    from public.users u where u.id = new.user_id;
  return new;
end;
$$;

create trigger user_profile_fields_default_visibility
  before insert on public.user_profile_fields
  for each row
  when (new.visibility is null)
  execute function kc_private.user_profile_fields_default_visibility();

create trigger user_profile_fields_set_updated_at
  before update on public.user_profile_fields
  for each row execute function kc_private.set_updated_at();

alter table public.user_profile_fields enable row level security;
alter table public.user_profile_fields force row level security;

-- The owner reads every field. Anyone else reads a field only when the owner's profile is
-- visible to them (so never across a block, and never for an inactive account) and the
-- field is open to everyone, or open to followers and the reader follows the owner.
create policy user_profile_fields_select_visible on public.user_profile_fields
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (visibility <> 'only_me'
        and exists (
          select 1
            from public.users u
           where u.id = user_profile_fields.user_id
             and (user_profile_fields.visibility = 'everyone'
                  or exists (select 1 from public.follows f
                              where f.follower_id = (select auth.uid())
                                and f.followed_id = u.id)))));

create policy user_profile_fields_insert_self on public.user_profile_fields
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy user_profile_fields_update_self on public.user_profile_fields
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Clearing a field is deleting its row.
create policy user_profile_fields_delete_self on public.user_profile_fields
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on public.user_profile_fields to authenticated;
grant update (visibility, tags, affiliated_org_id) on public.user_profile_fields to authenticated;
