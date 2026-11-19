-- Production copy (FR-ADMIN-037) · scope: the dev marker, the copy bookkeeping and what counts
-- as copied.
--
-- Everything in this directory is installed only on kc-dev (and local or CI scratch databases)
-- by supabase/seed/prod-copy/install.sql. It is never a migration: the production baseline
-- holds no seed, demo or dev object (docs/db/target-design.md §6, §9; decision D-239).

-- One row. `is_dev_environment` is the marker that allows a copy to be applied: only load.sql
-- sets it, and only when the session says `kc.seed_target = 'dev'`. The rest records the last
-- successful copy, which the admin portal's Demo data screen shows (AC13).
create table if not exists kc_private.prod_copy_state (
  singleton          boolean primary key default true check (singleton),
  is_dev_environment boolean not null default false,
  last_copied_at     timestamptz,
  -- Counts of the last successful copy (members, posts, organizations, follows, saved posts).
  last_result        jsonb not null default '{}'::jsonb check (jsonb_typeof(last_result) = 'object'),
  updated_at         timestamptz not null default now()
);
comment on table kc_private.prod_copy_state is
  'kc-dev production copy (FR-ADMIN-037): dev marker and the result of the last successful copy.';
alter table kc_private.prod_copy_state enable row level security;
alter table kc_private.prod_copy_state force row level security;
revoke all on kc_private.prod_copy_state from public, anon, authenticated;

insert into kc_private.prod_copy_state (singleton) values (true) on conflict (singleton) do nothing;

-- Copied posts and the hash of the copied fields they were created from. A post whose source
-- changed is replaced rather than edited (AC8), because the post status machine does not allow
-- every move a production post can make; the hash says which posts changed.
create table if not exists kc_private.prod_copy_posts (
  post_id      uuid primary key references public.posts (id) on delete cascade,
  content_hash text not null
);
comment on table kc_private.prod_copy_posts is
  'FR-ADMIN-037: posts created by the production copy, with the hash of their copied fields.';
alter table kc_private.prod_copy_posts enable row level security;
alter table kc_private.prod_copy_posts force row level security;
revoke all on kc_private.prod_copy_posts from public, anon, authenticated;

-- Copied organizations. Organizations have no owner to hang a marker on, so they are listed.
create table if not exists kc_private.prod_copy_organizations (
  organization_id uuid primary key references public.organizations (id) on delete cascade
);
comment on table kc_private.prod_copy_organizations is
  'FR-ADMIN-037: organizations created by the production copy.';
alter table kc_private.prod_copy_organizations enable row level security;
alter table kc_private.prod_copy_organizations force row level security;
revoke all on kc_private.prod_copy_organizations from public, anon, authenticated;

-- AC12: the copied members are auth accounts on the reserved test domain with the `prod_copy`
-- flag. Demo members (`demo` flag) and e2e members (no flag) never match, and copied members
-- never match the demo scope (kc_private.demo_member_ids), so neither wipe reaches the other.
create or replace function kc_private.prod_copy_member_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(u.id order by u.id), '{}')
    from auth.users u
   where u.email like 'prodcopy-%@seed.kc.test'
     and coalesce(u.raw_app_meta_data ->> 'prod_copy', '') = 'true';
$$;
comment on function kc_private.prod_copy_member_ids() is
  'Ids of the members created by the production copy (prodcopy-…@seed.kc.test, app_metadata.prod_copy = true).';

-- AC13: what the copy holds now. Posts are counted through their owners, so a post a copied
-- member could not have outside the copy is still counted and still deleted with them.
create or replace function kc_private.prod_copy_counts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with m as (select kc_private.prod_copy_member_ids() as ids)
  select jsonb_build_object(
    'members', cardinality(m.ids),
    'posts', (select count(*) from public.posts p where p.owner_id = any (m.ids)),
    'organizations', (select count(*) from kc_private.prod_copy_organizations),
    'follows', (select count(*) from public.follows f
                 where f.follower_id = any (m.ids) and f.followed_id = any (m.ids)),
    'saved_posts', (select count(*) from public.saved_posts s
                     join public.posts p on p.id = s.post_id
                    where s.user_id = any (m.ids) and p.owner_id = any (m.ids)))
    from m;
$$;
comment on function kc_private.prod_copy_counts() is
  'FR-ADMIN-037 AC13: how many copied members, posts, organizations, follows and saved posts exist.';

-- AC13: "Delete copied data". Removes every copied member (their posts, follows and saves
-- cascade with the account) and every copied organization; nothing else is touched. The next
-- copy creates them again. Returns what was deleted.
create or replace function kc_private.prod_copy_delete_all()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_before constant jsonb := kc_private.prod_copy_counts();
begin
  delete from public.posts p where p.owner_id = any (kc_private.prod_copy_member_ids());
  delete from auth.users u where u.id = any (kc_private.prod_copy_member_ids());
  delete from public.organizations o
   where o.id in (select c.organization_id from kc_private.prod_copy_organizations c);
  -- The time of the last copy is kept: the screen still says when the next one restores it.
  return v_before;
end;
$$;
comment on function kc_private.prod_copy_delete_all() is
  'FR-ADMIN-037 AC13: deletes every copied member (with all they own) and copied organization.';
