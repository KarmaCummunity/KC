-- Production copy (FR-ADMIN-037) · organizations, follows and saved posts.
--
-- Input elements (already anonymized, AC7):
--   organizations  { "id", "name", "org_type", "city_id", "is_verified_nonprofit",
--                    "public_tagline_he", "public_tagline_en", "public_about_he", "public_about_en" }
--   follows        { "follower_id", "followed_id", "created_at" }
--   saved_posts    { "user_id", "post_id", "saved_at" }

-- AC3: the public fields of active organizations (D155). The team, finance, contacts and
-- registration details stay in production. A copied organization gets a slug derived from its
-- keyed id, so it can never take the slug of a kc-dev organization.
-- Returns {organizations, organizations_created, organizations_deleted}.
create or replace function kc_private.prod_copy_sync_organizations(p_orgs jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_created integer;
  v_deleted integer;
begin
  if to_regclass('pg_temp.pc_org') is not null then drop table pg_temp.pc_org; end if;
  create temporary table pc_org on commit drop as
  select (o ->> 'id')::uuid as id,
         'prod-copy-' || left(replace(o ->> 'id', '-', ''), 12) as slug,
         left(o ->> 'name', 120) as name, o ->> 'org_type' as org_type, nullif(o ->> 'city_id', '') as city_id,
         coalesce((o ->> 'is_verified_nonprofit')::boolean, false) as is_verified_nonprofit,
         o ->> 'public_tagline_he' as public_tagline_he, o ->> 'public_tagline_en' as public_tagline_en,
         o ->> 'public_about_he' as public_about_he, o ->> 'public_about_en' as public_about_en
    from jsonb_array_elements(p_orgs) o;

  delete from public.organizations o
   where o.id in (select c.organization_id from kc_private.prod_copy_organizations c)
     and not exists (select 1 from pg_temp.pc_org n where n.id = o.id);
  get diagnostics v_deleted = row_count;

  -- Organizations are created active; kc-dev's own rules decide everything that follows.
  insert into public.organizations (id, slug, name, org_type, status, city_id, is_verified_nonprofit,
                                    public_tagline_he, public_tagline_en, public_about_he, public_about_en)
  select n.id, n.slug, n.name, n.org_type, 'active', n.city_id, n.is_verified_nonprofit,
         n.public_tagline_he, n.public_tagline_en, n.public_about_he, n.public_about_en
    from pg_temp.pc_org n
   where not exists (select 1 from public.organizations o where o.id = n.id);
  get diagnostics v_created = row_count;

  insert into kc_private.prod_copy_organizations (organization_id)
  select n.id from pg_temp.pc_org n
  on conflict (organization_id) do nothing;

  update public.organizations o
     set name = n.name, org_type = n.org_type, city_id = n.city_id,
         is_verified_nonprofit = n.is_verified_nonprofit,
         public_tagline_he = n.public_tagline_he, public_tagline_en = n.public_tagline_en,
         public_about_he = n.public_about_he, public_about_en = n.public_about_en
    from pg_temp.pc_org n
   where o.id = n.id
     and (o.name, o.org_type, o.city_id, o.is_verified_nonprofit, o.public_tagline_he, o.public_tagline_en,
          o.public_about_he, o.public_about_en)
         is distinct from (n.name, n.org_type, n.city_id, n.is_verified_nonprofit, n.public_tagline_he,
                           n.public_tagline_en, n.public_about_he, n.public_about_en);

  return jsonb_build_object('organizations', (select count(*) from kc_private.prod_copy_organizations),
                            'organizations_created', v_created, 'organizations_deleted', v_deleted);
end;
$$;
comment on function kc_private.prod_copy_sync_organizations(jsonb) is
  'FR-ADMIN-037: adds, updates and removes copied organizations (public fields only).';

-- AC3, AC8: follows and saved posts between copied members and copied posts. Only pairs with
-- both ends in the copy are touched: a kc-dev tester who follows a copied member, or saved a
-- copied post, keeps it. Returns {follows, saved_posts}.
create or replace function kc_private.prod_copy_sync_social(p_follows jsonb, p_saved jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_members constant uuid[] := kc_private.prod_copy_member_ids();
begin
  if to_regclass('pg_temp.pc_follow') is not null then drop table pg_temp.pc_follow; end if;
  create temporary table pc_follow on commit drop as
  select (f ->> 'follower_id')::uuid as follower_id, (f ->> 'followed_id')::uuid as followed_id,
         coalesce((f ->> 'created_at')::timestamptz, now()) as created_at
    from jsonb_array_elements(p_follows) f;

  delete from public.follows f
   where f.follower_id = any (v_members) and f.followed_id = any (v_members)
     and not exists (select 1 from pg_temp.pc_follow n
                      where n.follower_id = f.follower_id and n.followed_id = f.followed_id);

  insert into public.follows (follower_id, followed_id, created_at)
  select n.follower_id, n.followed_id, n.created_at
    from pg_temp.pc_follow n
   where n.follower_id = any (v_members) and n.followed_id = any (v_members)
     and n.follower_id <> n.followed_id
  on conflict do nothing;

  if to_regclass('pg_temp.pc_saved') is not null then drop table pg_temp.pc_saved; end if;
  create temporary table pc_saved on commit drop as
  select (s ->> 'user_id')::uuid as user_id, (s ->> 'post_id')::uuid as post_id,
         coalesce((s ->> 'saved_at')::timestamptz, now()) as saved_at
    from jsonb_array_elements(p_saved) s;

  delete from public.saved_posts s
   using public.posts p
   where p.id = s.post_id and s.user_id = any (v_members) and p.owner_id = any (v_members)
     and not exists (select 1 from pg_temp.pc_saved n where n.user_id = s.user_id and n.post_id = s.post_id);

  -- A save of a post the copy skipped has nothing to point at, so the join drops it.
  insert into public.saved_posts (user_id, post_id, saved_at)
  select n.user_id, n.post_id, n.saved_at
    from pg_temp.pc_saved n
    join public.posts p on p.id = n.post_id and p.owner_id = any (v_members)
   where n.user_id = any (v_members)
  on conflict do nothing;

  return jsonb_build_object(
    'follows', (select count(*) from public.follows f
                 where f.follower_id = any (v_members) and f.followed_id = any (v_members)),
    'saved_posts', (select count(*) from public.saved_posts s join public.posts p on p.id = s.post_id
                     where s.user_id = any (v_members) and p.owner_id = any (v_members)));
end;
$$;
comment on function kc_private.prod_copy_sync_social(jsonb, jsonb) is
  'FR-ADMIN-037: follows and saved posts between copied members and copied posts.';
