-- 0653_demo_wipe_publisher_refs | FR-ADMIN-031: legal/survey version rows keep
-- published_by → auth.users without ON DELETE; a seed user must not block demo wipe.

begin;

create or replace function public.kc_dev_wipe_demo_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
set statement_timeout = '300s'
as $$
declare
  v_users        integer;
  v_orgs_deleted integer := 0;
  v_orgs_kept    integer := 0;
  v_org_id       uuid;
  v_seed_ids     uuid[];
  v_keep_admin   uuid;
begin
  select coalesce(array_agg(u.id), '{}') into v_seed_ids
    from auth.users u
   where u.email like '%@seed.kc.test'
     and coalesce(u.raw_app_meta_data->>'seed', '') = 'true';

  if coalesce(array_length(v_seed_ids, 1), 0) = 0 then
    return jsonb_build_object('users_deleted', 0, 'organizations_deleted', 0, 'organizations_kept', 0);
  end if;

  delete from public.match_candidates mc
   where mc.offer_owner_id = any (v_seed_ids)
      or mc.request_owner_id = any (v_seed_ids);

  delete from public.match_listing_state mls
   where mls.listing_id in (select l.listing_id from public.listings l where l.owner_id = any (v_seed_ids));

  delete from public.giving_handoffs gh
   where gh.owner_id = any (v_seed_ids)
      or gh.recipient_id = any (v_seed_ids)
      or gh.listing_id in (select l.listing_id from public.listings l where l.owner_id = any (v_seed_ids));

  delete from public.listings l where l.owner_id = any (v_seed_ids);

  delete from public.challenge_progress_entries cpe
   where cpe.user_id = any (v_seed_ids)
      or cpe.challenge_id in (select c.challenge_id from public.challenges c where c.creator_id = any (v_seed_ids));

  delete from public.challenge_participations cp
   where cp.user_id = any (v_seed_ids)
      or cp.challenge_id in (select c.challenge_id from public.challenges c where c.creator_id = any (v_seed_ids));

  delete from public.challenges c where c.creator_id = any (v_seed_ids);

  delete from public.saved_posts sp where sp.user_id = any (v_seed_ids);

  delete from public.ride_listings rl where rl.owner_id = any (v_seed_ids);

  delete from public.chats c
   where c.participant_a = any (v_seed_ids) or c.participant_b = any (v_seed_ids);

  delete from public.follow_edges f
   where f.follower_id = any (v_seed_ids) or f.followed_id = any (v_seed_ids);

  delete from public.recipients r
   where r.recipient_user_id = any (v_seed_ids)
      or r.post_id in (select p.post_id from public.posts p where p.owner_id = any (v_seed_ids));

  delete from public.posts p where p.owner_id = any (v_seed_ids);

  delete from public.driver_declarations d where d.user_id = any (v_seed_ids);
  delete from public.housing_conduct_acceptances h where h.user_id = any (v_seed_ids);

  -- legal_document_versions / survey_versions reference auth.users with no ON DELETE.
  select g.user_id into v_keep_admin
    from public.admin_role_grants g
   where g.revoked_at is null
     and g.role = 'super_admin'
     and not public.is_demo_seed_user(g.user_id)
   order by g.granted_at nulls last
   limit 1;

  if v_keep_admin is null then
    select u.id into v_keep_admin
      from auth.users u
     where not public.is_demo_seed_user(u.id)
       and u.email = 'karmacommunity2.0@gmail.com'
     limit 1;
  end if;

  if v_keep_admin is not null then
    if exists (select 1 from public.legal_document_versions where published_by = any (v_seed_ids)) then
      alter table public.legal_document_versions disable trigger legal_document_versions_immutable_trg;
      update public.legal_document_versions
         set published_by = v_keep_admin
       where published_by = any (v_seed_ids);
      alter table public.legal_document_versions enable trigger legal_document_versions_immutable_trg;
    end if;

    update public.survey_versions
       set published_by = v_keep_admin
     where published_by = any (v_seed_ids);
  elsif exists (
    select 1 from public.legal_document_versions where published_by = any (v_seed_ids)
    union all
    select 1 from public.survey_versions where published_by = any (v_seed_ids)
  ) then
    raise exception 'demo_wipe_blocked_publisher_refs' using errcode = '23503';
  end if;

  update public.donation_links
     set hidden_by = null
   where hidden_by = any (v_seed_ids);

  delete from auth.users u where u.id = any (v_seed_ids);
  get diagnostics v_users = row_count;

  for v_org_id in
    select o.org_id from public.organizations o where o.verification_method = 'demo_seed'
  loop
    begin
      delete from public.organizations where org_id = v_org_id;
      v_orgs_deleted := v_orgs_deleted + 1;
    exception when foreign_key_violation then
      v_orgs_kept := v_orgs_kept + 1;
    end;
  end loop;

  return jsonb_build_object('users_deleted', v_users,
                            'organizations_deleted', v_orgs_deleted,
                            'organizations_kept', v_orgs_kept);
end;
$$;

comment on function public.kc_dev_wipe_demo_data() is
  'kc-dev demo data: deletes flagged seed users (with content, listings, matches, challenges) and [DEMO] nonprofits. Reassigns legal/survey publishers off seed users. Internal.';

commit;
