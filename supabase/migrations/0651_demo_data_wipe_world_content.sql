-- 0651_demo_data_wipe_world_content | FR-ADMIN-031: wipe explicit world listings,
-- match_candidates, and challenges before deleting seed posts/users (0648 scale).
-- Also raises RPC statement timeouts so portal wipe/seed survive on hosted kc-dev.

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
  'kc-dev demo data: deletes flagged seed users (with content, listings, matches, challenges) and [DEMO] nonprofits. Internal; no-op where none exist.';

create or replace function public.admin_wipe_demo_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
set statement_timeout = '300s'
as $$
declare
  v_actor  uuid := auth.uid();
  v_result jsonb;
begin
  if not public.can_manage_demo_data(v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if public.is_demo_seed_user(v_actor) then
    raise exception 'cannot_wipe_self' using errcode = '42501';
  end if;

  v_result := public.kc_dev_wipe_demo_data();

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'admin_wipe_demo_data', 'none', null, v_result);

  return v_result;
end;
$$;

create or replace function public.admin_seed_demo_data(p_password text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
set statement_timeout = '600s'
as $$
declare
  v_actor  uuid := auth.uid();
  v_hash   text;
  v_result jsonb;
begin
  if not public.can_manage_demo_data(v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not exists (select 1 from public.kc_dev_demo_config) then
    raise exception 'not_dev_environment' using errcode = '42501';
  end if;

  if p_password is not null and length(p_password) < 8 then
    raise exception 'password_too_short' using errcode = '22023';
  end if;

  if p_password is not null then
    v_hash := extensions.crypt(p_password, extensions.gen_salt('bf'));
    update public.kc_dev_demo_config set password_hash = v_hash;
  else
    select password_hash into v_hash from public.kc_dev_demo_config;
  end if;
  if v_hash is null then
    raise exception 'password_required' using errcode = '22023';
  end if;

  v_result := public.kc_dev_seed_demo_data(v_hash);

  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'admin_seed_demo_data', 'none', null, v_result);

  return v_result;
end;
$$;

alter function public.kc_dev_seed_demo_data(text) set statement_timeout = '600s';

commit;
