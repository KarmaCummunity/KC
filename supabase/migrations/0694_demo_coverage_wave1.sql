-- 0694_demo_coverage_wave1 | #1964: Demo Coverage Catalog wave 1 (FSM equivalence classes).
-- Post S1 (7), admin_task (5), report (3); admin_demo_coverage_report() audit RPC.
-- See docs/qa/DEMO_COVERAGE.md.

begin;

-- ── 1. Upsert one deterministic seed user (idempotent on re-seed) ──────────────
create or replace function public.kc_dev_upsert_dcc_user(
  p_local_part text,
  p_display_name text,
  p_password_hash text,
  p_fixture text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_email text := p_local_part || '@seed.kc.test';
  v_id uuid;
  v_city text := '3000';
begin
  select u.id into v_id from auth.users u where u.email = v_email;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      v_email, p_password_hash, now(),
      jsonb_build_object('provider', 'email', 'providers', array['email'], 'seed', true, 'dcc', 'wave1', 'fixture', p_fixture),
      jsonb_build_object('full_name', p_display_name, 'seed', true),
      now(), now(), '', '', '', '');
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), v_id, v_id::text,
      jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now());
  else
    update auth.users
       set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                            || jsonb_build_object('seed', true, 'dcc', 'wave1', 'fixture', p_fixture)
     where id = v_id;
  end if;

  update public.users u
     set display_name = left(p_display_name, 50),
         city = v_city,
         city_name = (select c.name_he from public.cities c where c.city_id = v_city),
         account_status = 'active',
         onboarding_state = 'completed',
         preferred_language = 'he',
         privacy_mode = 'Public'
   where u.user_id = v_id;

  return v_id;
end;
$$;

comment on function public.kc_dev_upsert_dcc_user(text, text, text, text) is
  'kc-dev only: deterministic demo-coverage user under @seed.kc.test (wave 1).';

revoke all on function public.kc_dev_upsert_dcc_user(text, text, text, text) from public, anon, authenticated;
grant execute on function public.kc_dev_upsert_dcc_user(text, text, text, text) to service_role;

-- ── 2. Wave 1 fixtures ─────────────────────────────────────────────────────────
create or replace function public.kc_dev_seed_demo_coverage_wave1(p_password_hash text)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_recipient uuid;
  v_reporter uuid;
  v_resolver uuid;
  v_admin uuid;
  v_owner uuid;
  v_post_id uuid;
  v_states text[] := array[
    'open', 'paused', 'expired', 'closed_delivered', 'deleted_no_recipient',
    'hidden_pending_review', 'removed_admin'];
  v_state text;
  v_task_states text[] := array['open', 'in_progress', 'blocked', 'done', 'archived'];
  v_ts text;
  v_now timestamptz := now();
begin
  if not exists (select 1 from public.kc_dev_demo_config) then
    raise exception 'not_dev_environment' using errcode = '42501';
  end if;
  if coalesce(p_password_hash, '') = '' then
    raise exception 'password_required' using errcode = '22023';
  end if;

  v_recipient := public.kc_dev_upsert_dcc_user(
    'dcc-shared-recipient', 'DCC נמען משותף', p_password_hash, 'helper:recipient');
  v_reporter := public.kc_dev_upsert_dcc_user(
    'dcc-shared-reporter', 'DCC מדווח משותף', p_password_hash, 'helper:reporter');

  select g.user_id into v_resolver
    from public.admin_role_grants g
   where g.revoked_at is null and g.role in ('super_admin', 'moderator')
   order by case g.role when 'super_admin' then 0 else 1 end
   limit 1;

  if v_resolver is null then
    select u.user_id into v_resolver
      from public.users u
     where not public.is_demo_seed_user(u.user_id)
     order by u.is_super_admin desc nulls last
     limit 1;
  end if;
  v_admin := coalesce(v_resolver, v_reporter);

  foreach v_state in array v_states loop
    v_owner := public.kc_dev_upsert_dcc_user(
      'dcc-post-' || replace(v_state, '_', '-'),
      'DCC פוסט — ' || v_state,
      p_password_hash,
      'post:' || v_state);

    delete from public.recipients r
     using public.posts p
     where r.post_id = p.post_id and p.owner_id = v_owner
       and p.title like '[DCC] Post S1 — %';

    delete from public.posts p
     where p.owner_id = v_owner and p.title like '[DCC] Post S1 — %';

    v_post_id := gen_random_uuid();
    insert into public.posts (
      post_id, owner_id, type, status, visibility, title, description, category,
      city, street, street_number, location_display_level, created_at, source_language,
      status_before_admin_removal)
    values (
      v_post_id, v_owner, 'Give', v_state, 'Public',
      '[DCC] Post S1 — ' || v_state,
      'פוסט דמה לכיסוי מכונת מצבים (גל 1). מצב: ' || v_state,
      'Other', '3000', 'הרצל', '1', 'CityAndStreet', v_now - interval '2 days', 'he',
      case when v_state = 'removed_admin' then 'open' else null end);

    if v_state = 'closed_delivered' then
      insert into public.recipients (post_id, recipient_user_id, marked_at)
      values (v_post_id, v_recipient, v_now - interval '1 day');
    end if;
  end loop;

  alter table public.reports disable trigger reports_rate_limit;
  delete from public.reports where note like 'dcc_wave1:%';

  insert into public.reports (
    reporter_id, target_type, target_id, reason, note, status, created_at)
  values (
    v_reporter, 'post',
    (select post_id from public.posts where title = '[DCC] Post S1 — open' limit 1),
    'Other', 'dcc_wave1:open', 'open', v_now - interval '3 days');

  if v_resolver is not null then
    insert into public.reports (
      reporter_id, target_type, target_id, reason, note, status, created_at, resolved_at, resolved_by)
    values (
      v_reporter, 'post',
      (select post_id from public.posts where title = '[DCC] Post S1 — paused' limit 1),
      'Spam', 'dcc_wave1:confirmed_violation', 'confirmed_violation',
      v_now - interval '5 days', v_now - interval '4 days', v_resolver);

    insert into public.reports (
      reporter_id, target_type, target_id, reason, note, status, created_at, resolved_at, resolved_by)
    values (
      v_reporter, 'post',
      (select post_id from public.posts where title = '[DCC] Post S1 — expired' limit 1),
      'Misleading', 'dcc_wave1:dismissed_no_violation', 'dismissed_no_violation',
      v_now - interval '6 days', v_now - interval '5 days', v_resolver);
  end if;
  alter table public.reports enable trigger reports_rate_limit;

  delete from public.admin_tasks where title like '[DCC] admin_task — %';
  foreach v_ts in array v_task_states loop
    insert into public.admin_tasks (title, description, status, created_by, labels)
    values (
      '[DCC] admin_task — ' || v_ts,
      'משימת אדמין לכיסוי FSM (גל 1)',
      v_ts, v_admin, array['dcc_wave1', 'demo_coverage']);
  end loop;
end;
$$;

comment on function public.kc_dev_seed_demo_coverage_wave1(text) is
  'kc-dev only: wave-1 Demo Coverage Catalog — one row per P0 FSM state (post, admin_task, report).';

revoke all on function public.kc_dev_seed_demo_coverage_wave1(text) from public, anon, authenticated;
grant execute on function public.kc_dev_seed_demo_coverage_wave1(text) to service_role;

-- ── 3. Coverage snapshot (internal + admin RPC) ───────────────────────────────
create or replace function public.kc_dev_demo_coverage_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  with
  post_expected(state) as (
    values
      ('open'), ('paused'), ('expired'), ('closed_delivered'), ('deleted_no_recipient'),
      ('hidden_pending_review'), ('removed_admin')
  ),
  post_covered(state) as (
    select distinct p.status
      from public.posts p
      join auth.users u on u.id = p.owner_id
     where p.title like '[DCC] Post S1 — %'
       and u.email like 'dcc-post-%@seed.kc.test'
       and coalesce(u.raw_app_meta_data->>'seed', '') = 'true'
  ),
  post_gaps(state) as (
    select e.state from post_expected e
    where not exists (select 1 from post_covered c where c.state = e.state)
  ),
  task_expected(state) as (
  values ('open'), ('in_progress'), ('blocked'), ('done'), ('archived')
  ),
  task_covered(state) as (
    select distinct t.status from public.admin_tasks t where t.title like '[DCC] admin_task — %'
  ),
  task_gaps(state) as (
    select e.state from task_expected e
    where not exists (select 1 from task_covered c where c.state = e.state)
  ),
  report_expected(state) as (
    values ('open'), ('confirmed_violation'), ('dismissed_no_violation')
  ),
  report_covered(state) as (
    select distinct r.status from public.reports r where r.note like 'dcc_wave1:%'
  ),
  report_gaps(state) as (
    select e.state from report_expected e
    where not exists (select 1 from report_covered c where c.state = e.state)
  ),
  all_gaps(machine, state) as (
    select 'post', state from post_gaps
    union all select 'admin_task', state from task_gaps
    union all select 'report', state from report_gaps
  )
  select jsonb_build_object(
    'wave', 1,
    'complete', not exists (select 1 from all_gaps),
    'gaps',
      coalesce(
        (select jsonb_agg(jsonb_build_object('machine', machine, 'state', state) order by machine, state)
           from all_gaps),
        '[]'::jsonb),
    'machines', jsonb_build_object(
      'post', jsonb_build_object(
        'expected', 7,
        'covered', (select count(*) from post_covered),
        'missing', coalesce((select jsonb_agg(state order by state) from post_gaps), '[]'::jsonb)),
      'admin_task', jsonb_build_object(
        'expected', 5,
        'covered', (select count(*) from task_covered),
        'missing', coalesce((select jsonb_agg(state order by state) from task_gaps), '[]'::jsonb)),
      'report', jsonb_build_object(
        'expected', 3,
        'covered', (select count(*) from report_covered),
        'missing', coalesce((select jsonb_agg(state order by state) from report_gaps), '[]'::jsonb))));
$$;

comment on function public.kc_dev_demo_coverage_snapshot() is
  'kc-dev: wave-1 coverage gaps for posts, admin_tasks, reports (DCC).';

revoke all on function public.kc_dev_demo_coverage_snapshot() from public, anon, authenticated;
grant execute on function public.kc_dev_demo_coverage_snapshot() to service_role;

create or replace function public.admin_demo_coverage_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_manage_demo_data(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.kc_dev_demo_config) then
    raise exception 'not_dev_environment' using errcode = '42501';
  end if;
  return public.kc_dev_demo_coverage_snapshot();
end;
$$;

comment on function public.admin_demo_coverage_report() is
  'FR-ADMIN-031 / DCC wave 1: JSON audit of deterministic FSM fixture coverage on kc-dev.';

revoke all on function public.admin_demo_coverage_report() from public, anon;
grant execute on function public.admin_demo_coverage_report() to authenticated;

-- ── 4. Seed pipeline: phase `coverage` after orgs ───────────────────────────
create or replace function public.kc_dev_seed_with_caps_off(p_phase text, p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims text := coalesce(current_setting('request.jwt.claims', true), '');
  v_sub text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  v_world jsonb;
  v_match integer;
  v_hash text;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  if p_phase = 'users' then
    perform public.kc_dev_seed_rate_limits(false);
  end if;
  case p_phase
    when 'users' then
      perform public.kc_dev_seed_phase_users(p_hash);
      perform public.kc_dev_seed_demo_user_profiles();
    when 'items' then
      perform public.kc_dev_seed_phase_items();
      perform public.kc_dev_seed_demo_post_media();
    when 'worlds' then
      v_world := public.kc_dev_seed_demo_world_content();
      perform public.kc_dev_seed_demo_verification_mix();
    when 'social' then
      perform public.kc_dev_seed_phase_social();
      perform public.kc_dev_seed_demo_reports();
      perform public.kc_dev_seed_rate_limits(true);
    when 'matches' then v_match := public.kc_dev_seed_demo_match_candidates();
    when 'orgs' then perform public.kc_dev_seed_phase_orgs();
    when 'coverage' then
      select password_hash into v_hash from public.kc_dev_demo_config where singleton;
      perform public.kc_dev_seed_demo_coverage_wave1(v_hash);
    else raise exception 'demo_seed_invalid_phase' using errcode = '22023';
  end case;
  perform set_config('request.jwt.claims', v_claims, true);
  perform set_config('request.jwt.claim.sub', v_sub, true);
  return jsonb_build_object(
    'world', v_world,
    'match_candidates', v_match,
    'demo_coverage', case when p_phase = 'coverage' then public.kc_dev_demo_coverage_snapshot() else null end);
end;
$$;

create or replace function public.kc_dev_seed_advance_phase(p_password_hash text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
set statement_timeout = '120s'
as $$
declare
  v_op text;
  v_phase text;
  v_aux jsonb;
  v_updated timestamptz;
  v_hash text;
  v_ids uuid[];
  v_step text;
  v_batch jsonb;
  v_wrapped jsonb;
  v_result jsonb;
begin
  if not exists (select 1 from public.kc_dev_demo_config) then
    raise exception 'not_dev_environment' using errcode = '42501';
  end if;

  select operation, phase, aux, updated_at
    into v_op, v_phase, v_aux, v_updated
    from public.kc_dev_demo_operation_state
   where singleton
   for update;

  if v_phase <> 'idle' and v_updated < now() - interval '3 minutes' then
    update public.kc_dev_demo_operation_state
       set operation = 'idle', phase = 'idle', aux = '{}'::jsonb, actor_id = null, updated_at = now()
     where singleton;
    v_op := 'idle';
    v_phase := 'idle';
    v_aux := '{}'::jsonb;
  end if;

  if v_op = 'wipe' and v_phase <> 'idle' then
    raise exception 'demo_operation_busy' using errcode = '42501';
  end if;

  if v_phase = 'idle' then
    v_hash := coalesce(p_password_hash, '');
    if v_hash = '' then
      select password_hash into v_hash from public.kc_dev_demo_config where singleton;
    end if;
    if coalesce(v_hash, '') = '' then
      raise exception 'password_required' using errcode = '22023';
    end if;
    v_aux := jsonb_build_object('wipe_step', 'match_candidates');
    update public.kc_dev_demo_operation_state
       set operation = 'seed', phase = 'wipe', actor_id = null, started_at = now(),
           aux = v_aux, updated_at = now()
     where singleton;
    v_phase := 'wipe';
  elsif p_password_hash is not null then
    raise exception 'demo_operation_busy' using errcode = '42501';
  end if;

  if v_phase = 'wipe' then
    v_ids := public.kc_dev_wipe_demo_seed_ids();
    v_step := coalesce(v_aux->>'wipe_step', 'match_candidates');
    if v_step = 'accounts' then
      perform public.kc_dev_wipe_demo_data_accounts(v_ids);
      update public.kc_dev_demo_operation_state
         set phase = 'users', aux = '{}'::jsonb, updated_at = now()
       where singleton;
      return jsonb_build_object('done', false, 'phase', 'users', 'progress_key', 'wipe', 'retry', false);
    end if;
    v_batch := public.kc_dev_wipe_content_slice(v_ids, v_step);
    if coalesce((v_batch->>'content_done')::boolean, false) then
      update public.kc_dev_demo_operation_state
         set aux = jsonb_build_object('wipe_step', 'accounts'), updated_at = now()
       where singleton;
      return jsonb_build_object('done', false, 'phase', 'wipe', 'progress_key', 'wipe', 'retry', false);
    end if;
    update public.kc_dev_demo_operation_state
       set aux = jsonb_build_object('wipe_step', v_batch->>'step'), updated_at = now()
     where singleton;
    return jsonb_build_object(
      'done', false, 'phase', 'wipe', 'progress_key', 'wipe',
      'retry', coalesce((v_batch->>'retry')::boolean, false));
  end if;

  if v_phase = 'users' then
    select password_hash into v_hash from public.kc_dev_demo_config where singleton;
    perform public.kc_dev_seed_with_caps_off('users', v_hash);
    update public.kc_dev_demo_operation_state set phase = 'items', updated_at = now() where singleton;
    return jsonb_build_object('done', false, 'phase', 'items', 'progress_key', 'users', 'retry', false);
  elsif v_phase = 'items' then
    perform public.kc_dev_seed_with_caps_off('items', null);
    update public.kc_dev_demo_operation_state set phase = 'worlds', updated_at = now() where singleton;
    return jsonb_build_object('done', false, 'phase', 'worlds', 'progress_key', 'items', 'retry', false);
  elsif v_phase = 'worlds' then
    v_wrapped := public.kc_dev_seed_with_caps_off('worlds', null);
    update public.kc_dev_demo_operation_state
       set phase = 'social', aux = coalesce(v_wrapped->'world', '{}'::jsonb), updated_at = now()
     where singleton;
    return jsonb_build_object('done', false, 'phase', 'social', 'progress_key', 'worlds', 'retry', false);
  elsif v_phase = 'social' then
    perform public.kc_dev_seed_with_caps_off('social', null);
    update public.kc_dev_demo_operation_state set phase = 'matches', updated_at = now() where singleton;
    return jsonb_build_object('done', false, 'phase', 'matches', 'progress_key', 'social', 'retry', false);
  elsif v_phase = 'matches' then
    v_wrapped := public.kc_dev_seed_with_caps_off('matches', null);
    v_aux := coalesce(v_aux, '{}'::jsonb) || jsonb_build_object('match_candidates', v_wrapped->'match_candidates');
    update public.kc_dev_demo_operation_state set phase = 'orgs', aux = v_aux, updated_at = now() where singleton;
    return jsonb_build_object('done', false, 'phase', 'orgs', 'progress_key', 'matches', 'retry', false);
  elsif v_phase = 'orgs' then
    perform public.kc_dev_seed_with_caps_off('orgs', null);
    update public.kc_dev_demo_operation_state set phase = 'coverage', updated_at = now() where singleton;
    return jsonb_build_object('done', false, 'phase', 'coverage', 'progress_key', 'orgs', 'retry', false);
  elsif v_phase = 'coverage' then
    v_wrapped := public.kc_dev_seed_with_caps_off('coverage', null);
    v_aux := coalesce(v_aux, '{}'::jsonb) || jsonb_build_object('demo_coverage', v_wrapped->'demo_coverage');
    v_result := public.kc_dev_seed_build_result(v_aux);
    update public.kc_dev_demo_operation_state
       set operation = 'idle', phase = 'idle', actor_id = null, aux = '{}'::jsonb, updated_at = now()
     where singleton;
    return jsonb_build_object('done', true, 'phase', 'idle', 'progress_key', 'done', 'retry', false, 'result', v_result);
  end if;

  raise exception 'demo_seed_invalid_phase' using errcode = '22023';
end;
$$;

commit;
