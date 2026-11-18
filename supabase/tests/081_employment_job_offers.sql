-- Employment: a job offer is published only in the name of an organization allowed to post
-- jobs (a platform admin's switch) or of the platform organization; looking for work stays
-- open to every member (docs/spec/05_giving_worlds.md §5.11, #1476).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Shorthand inside SQL text: @x the member with hex digit x, #title a post, &slug an
-- organization. Posts and organizations are resolved as the database owner.
create function pg_temp.expand(p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql text := p_sql;
  v_match text[];
begin
  for v_match in select regexp_matches(p_sql, '#(\w+)', 'g') loop
    v_sql := regexp_replace(v_sql, '#' || v_match[1] || '\M', coalesce(quote_literal((
      select p.id from public.posts p where p.title = v_match[1])), 'null') || '::uuid');
  end loop;
  for v_match in select regexp_matches(p_sql, '&([a-z-]+)', 'g') loop
    v_sql := regexp_replace(v_sql, '&' || v_match[1] || '\M', coalesce(quote_literal((
      select o.id from public.organizations o where o.slug = v_match[1])), 'null') || '::uuid');
  end loop;
  return regexp_replace(v_sql, '@([0-9a-f])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
end;
$$;

create function pg_temp.become(p_who text)
returns void
language plpgsql
as $$
begin
  if p_who is null or p_who = 'none' then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
  else
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
end;
$$;
-- Called again after the role was switched, to switch back.
grant execute on function pg_temp.become(text) to public;

-- Runs a statement as a member: 'ok', the P0001 message, or the SQLSTATE.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
begin
  begin
    perform pg_temp.become(p_who);
    execute v_sql;
    perform pg_temp.become('none');
    return 'ok';
  exception when others then
    perform pg_temp.become('none');
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- One value read as the database owner.
create function pg_temp.val(p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  execute pg_temp.expand(p_sql) into v_value;
  return v_value;
end;
$$;

-- A member inserts an employment post of `p_kind` titled `p_title`, open unless
-- `p_status` says otherwise, in the name of the organization `p_org` (SQL text, may be null).
create function pg_temp.post(p_who text, p_kind text, p_title text, p_org text, p_status text default 'open')
returns text
language sql
as $$
  select pg_temp.act(p_who, format(
    $f$insert into public.posts (owner_id, world_slug, kind_id, direction, status, title, city_id, beneficiary_org_id)
       select @%s, 'employment', k.id, k.direction, %L, %L, 'c1', %s
         from public.post_kinds k where k.world_slug = 'employment' and k.slug = %L$f$,
    p_who, p_status, p_title, p_org, p_kind));
$$;

select plan(12);

-- d platform admin · e admin of `allowed` · f admin of `other` · k employee of the platform
-- organization · 1 a member outside every organization.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(string_to_array('d,e,f,1', ',')) x;
insert into auth.users (id, email, raw_app_meta_data)
values ('00000000-0000-4000-8000-00000000000b', 'k@example.test', '{"provider":"google"}');
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('employment', 'employment', 'Employment');
insert into public.post_kinds (world_slug, slug, label_he, label_en, direction) values
  ('employment', 'job_offer', 'jo', 'Job offer', 'offer'), ('employment', 'job_request', 'jr', 'Job request', 'request');
insert into public.organizations (slug, name, is_platform) values
  ('kc', 'Karma Community', true), ('allowed', 'Allowed Org', false), ('other', 'Other Org', false);
insert into public.admin_role_grants (user_id, role, scope_org_id)
select '00000000-0000-4000-8000-00000000000d'::uuid, 'admin', null
union all select '00000000-0000-4000-8000-00000000000e', 'org_admin', id from public.organizations where slug = 'allowed'
union all select '00000000-0000-4000-8000-00000000000f', 'org_admin', id from public.organizations where slug = 'other'
union all select '00000000-0000-4000-8000-00000000000b', 'org_employee', id from public.organizations where slug = 'kc';

-- ── The switch ──────────────────────────────────────────────────────────────
select is(pg_temp.val($$select string_agg(may_post_jobs::text, ',' order by slug) from public.organizations$$),
  'false,false,false', 'no organization may post jobs until a platform admin allows it');
select is(pg_temp.act('e', $$select public.admin_set_org_may_post_jobs(&allowed, true)$$)
  || '|' || pg_temp.act('e', $$update public.organizations set may_post_jobs = true where slug = 'allowed'$$)
  || '|' || pg_temp.act('d', $$select public.admin_set_org_may_post_jobs(gen_random_uuid(), true)$$),
  '42501|42501|org_not_found', 'only a platform admin sets it, through the RPC, on a real organization');
select is(pg_temp.act('d', $$select public.admin_set_org_may_post_jobs(&allowed, true)$$)
  || pg_temp.val($$select may_post_jobs::text from public.organizations where slug = 'allowed'$$)
  || pg_temp.val($$select count(*) from audit.events where action = 'org_job_posting_set'
                     and (metadata ->> 'may_post_jobs')::boolean$$),
  'oktrue1', 'a platform admin allows an organization, audited');

-- ── Who publishes a job offer ───────────────────────────────────────────────
select is(pg_temp.post('1', 'job_offer', 'nameless', 'null'), 'job_offer_org_required',
  'a member cannot publish a job offer in their own name');
select is(pg_temp.post('f', 'job_offer', 'notallowed', '&other'), 'job_offer_org_required',
  'an organization the admin did not allow cannot publish a job offer');
select is(pg_temp.post('e', 'job_offer', 'allowedjob', '&allowed'), 'ok',
  'an allowed organization publishes a job offer');
select is(pg_temp.post('b', 'job_offer', 'kcjob', '&kc'), 'ok',
  'the platform organization publishes job offers without the switch');
select is(pg_temp.post('1', 'job_request', 'seeker', 'null'), 'ok',
  'every member may say they are looking for work');

-- ── Every way to become an open job offer is judged ───────────────────────
select is(pg_temp.post('f', 'job_offer', 'otherdraft', '&other', 'draft')
  || '|' || pg_temp.act('f', $$select public.publish_post(#otherdraft)$$)
  || '|' || pg_temp.act('d', $$select public.admin_set_org_may_post_jobs(&other, true)$$)
  || '|' || pg_temp.act('f', $$select public.publish_post(#otherdraft)$$),
  'ok|job_offer_org_required|ok|ok', 'a draft is prepared freely and published once its organization is allowed');
select is(pg_temp.act('e', $$select public.set_post_organization(#allowedjob, null)$$)
  || pg_temp.val($$select beneficiary_org_id = &allowed from public.posts where title = 'allowedjob'$$),
  'job_offer_org_requiredtrue', 'an open job offer cannot drop its organization');

-- ── Turning the switch off ──────────────────────────────────────────────────
select is(pg_temp.act('d', $$select public.admin_set_org_may_post_jobs(&allowed, false)$$)
  || '|' || pg_temp.post('e', 'job_offer', 'afteroff', '&allowed')
  || '|' || pg_temp.val($$select status from public.posts where title = 'allowedjob'$$),
  'ok|job_offer_org_required|open', 'stopping an organization blocks new job offers and leaves open ones as they are');
select is(pg_temp.act('d', $$select public.admin_set_org_status(&other, 'suspended')$$)
  || '|' || pg_temp.val($$select kc_private.org_may_post_jobs(&other)::text$$),
  'ok|false', 'a suspended organization may not post jobs, whatever its switch');

select * from finish();
rollback;
