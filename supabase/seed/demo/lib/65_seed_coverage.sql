-- Demo data (FR-ADMIN-031) · restore phase "coverage": one fixture per state of the lifecycle
-- machines of wave 1 of the Demo Coverage Catalog (docs/qa/DEMO_COVERAGE.md).
--
-- Wave 1 covers the machines `post`, `admin_task` and `report`. A fixture exists for every
-- state the kernel (kc_private.fsm_state) knows, so a state added later shows up as a gap in
-- the coverage report until a fixture is written for it.
--
-- Posts are inserted as draft or open and then moved with post_move. Admin tasks are
-- inserted already in their target status (legal on INSERT). Reports are written to the
-- resolved status the same way report_resolve does, not through admin_confirm_report /
-- admin_dismiss_report. The two fixture members are demo members
-- (`demo-dcc-*@seed.kc.test`, `demo` flag), so the demo wipe removes them with everything
-- they own; the tasks and reports, which no member owns, are removed by the wipe through
-- their markers.

-- Marker of the fixture rows that no member owns (see kc_private.demo_wipe_content).
create or replace function kc_private.demo_coverage_label()
returns text
language sql
immutable
set search_path = ''
as $$ select 'demo_coverage'; $$;

-- Creates the two fixture members (the post owner and the counterpart who receives, reports
-- and resolves) the way demo_seed_members does: an auth account with a confirmed email and its
-- email identity; the baseline trigger builds the member rows. Returns owner and guest ids.
create or replace function kc_private.demo_seed_coverage_members(p_password_hash text)
returns uuid[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_slugs constant text[] := array['owner', 'guest'];
  v_names constant text[] := array['DCC בעל הפוסט', 'DCC צד שני'];
  v_city constant text := (kc_private.demo_city_pool())[1];
  v_ids uuid[];
begin
  if coalesce(p_password_hash, '') = '' then
    raise exception 'password_required' using errcode = 'P0001';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
         'demo-dcc-' || s.slug || '@seed.kc.test', p_password_hash, now(),
         jsonb_build_object('provider', 'email', 'providers', array['email'], 'seed', true, 'demo', true),
         jsonb_build_object('full_name', v_names[s.n], 'seed', true, 'demo', true),
         now(), now(), '', '', '', ''
    from unnest(v_slugs) with ordinality s (slug, n)
   where not exists (select 1 from auth.users u where u.email = 'demo-dcc-' || s.slug || '@seed.kc.test');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.id::text,
         jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
         'email', now(), now(), now()
    from auth.users u
   where u.email like 'demo-dcc-%@seed.kc.test'
     and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

  update public.users p
     set display_name = v_names[array_position(v_slugs, substring(u.email from '^demo-dcc-(.+)@'))],
         city_id = v_city,
         privacy_mode = 'Public',
         preferred_language = 'he'
    from auth.users u
   where p.id = u.id and u.email like 'demo-dcc-%@seed.kc.test';

  update public.user_account a
     set onboarding_state = 'completed'
    from auth.users u
   where a.user_id = u.id and u.email like 'demo-dcc-%@seed.kc.test' and a.onboarding_state <> 'completed';

  select array_agg(u.id order by u.email desc) into v_ids
    from auth.users u where u.email in ('demo-dcc-owner@seed.kc.test', 'demo-dcc-guest@seed.kc.test');
  return v_ids;
end;
$$;
comment on function kc_private.demo_seed_coverage_members(text) is
  'Demo restore phase "coverage": creates the two fixture members; returns {owner, guest}.';

-- Creates the fixtures; returns how many rows were written (posts, tasks and reports).
-- `p_actor_id` is the admin who restored, recorded as the resolver of the closed reports
-- (null from the command line).
create or replace function kc_private.demo_seed_coverage(p_actor_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- (post status, role that moves an open post there; '' = stays open; 'draft' is inserted)
  v_posts constant text[][] := array[
    array['draft', ''], array['open', ''], array['paused', 'owner'], array['expired', 'system'],
    array['closed_delivered', 'owner'], array['deleted_no_recipient', 'owner'],
    array['hidden_pending_review', 'system'], array['removed_admin', 'admin']];
  -- (status of the report, status of the post it is about)
  v_reports constant text[][] := array[
    array['open', 'open'], array['confirmed_violation', 'paused'], array['dismissed_no_violation', 'expired']];
  v_label constant text := kc_private.demo_coverage_label();
  v_members constant uuid[] := kc_private.demo_seed_coverage_members(
    (select s.password_hash from kc_private.demo_data_state s where s.singleton));
  v_owner constant uuid := v_members[1];
  v_guest constant uuid := v_members[2];
  v_world constant text := 'items';
  v_kind constant uuid := (select k.id from public.post_kinds k
                            where k.world_slug = v_world and k.is_active and k.direction in ('offer', 'either')
                            order by k.direction = 'offer' desc, k.sort_order limit 1);
  v_city constant text := (select u.city_id from public.users u where u.id = v_owner);
  v_post_id uuid;
  v_status text;
  v_role text;
  v_report_id uuid;
  v_created integer := 0;
  v_rows integer;
begin
  if v_kind is null then
    raise exception 'reference_data_missing' using errcode = 'P0001', detail = 'no active item post kind';
  end if;

  -- Posts: published as open (a draft stays a draft), then moved along the post machine.
  for i in 1..array_length(v_posts, 1) loop
    v_status := v_posts[i][1];
    v_role := v_posts[i][2];
    insert into public.posts (owner_id, world_slug, kind_id, direction, status, visibility, title, description,
                              city_id, location_display_level, source_language)
    values (v_owner, v_world, v_kind, 'offer', case when v_status = 'draft' then 'draft' else 'open' end, 'Public',
            '[DCC] Post S1 — ' || v_status, 'פוסט דמה לכיסוי מכונת המצבים. מצב: ' || v_status,
            v_city, 'CityOnly', 'he')
    returning id into v_post_id;

    -- A delivered post has a recipient: the handoff the owner marked as handed over.
    if v_status = 'closed_delivered' then
      insert into public.post_handoffs (post_id, owner_id, recipient_id, status)
      values (v_post_id, v_owner, v_guest, 'handed_over');
    end if;
    if v_role <> '' then
      perform kc_private.post_move(v_post_id, v_status, v_role);
    end if;
    v_created := v_created + 1;
  end loop;

  -- Admin tasks: one per state of the machine (no member owns them; the label marks them).
  insert into kc_private.admin_tasks (title, description, status, category, labels)
  select '[DCC] admin_task — ' || s.status, 'משימת דמה לכיסוי מכונת המצבים', s.status, 'other',
         array[v_label]
    from kc_private.fsm_state s where s.machine_id = 'admin_task';
  get diagnostics v_rows = row_count;
  v_created := v_created + v_rows;

  -- Reports: filed open about a post, then closed by staff through the report machine.
  for i in 1..array_length(v_reports, 1) loop
    v_status := v_reports[i][1];
    insert into public.reports (reporter_id, target_type, target_id, reason, note, created_at)
    values (v_guest, 'post',
            (select p.id from public.posts p where p.owner_id = v_owner and p.title = '[DCC] Post S1 — ' || v_reports[i][2]),
            'Other', 'demo-coverage:' || v_status, now() - interval '3 days')
    returning id into v_report_id;
    if v_status <> 'open' then
      perform set_config('kc.fsm_role', 'admin', true);
      update public.reports r
         set status = v_status, resolved_at = now() - interval '1 day', resolved_by = p_actor_id
       where r.id = v_report_id;
      perform set_config('kc.fsm_role', '', true);
    end if;
    v_created := v_created + 1;
  end loop;

  return v_created;
end;
$$;
comment on function kc_private.demo_seed_coverage(uuid) is
  'Demo restore phase "coverage": one post, admin task and report per state of their machines (wave 1).';

-- The coverage of wave 1: for each machine, how many of its states have a fixture, and which
-- states have none. The expected states are the kernel's, so a new state is reported as a gap.
create or replace function kc_private.demo_coverage_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with expected (machine, status) as (
    select s.machine_id, s.status from kc_private.fsm_state s
     where s.machine_id in ('post', 'admin_task', 'report')),
  covered (machine, status) as (
    select 'post', p.status from public.posts p
     where p.owner_id = any (kc_private.demo_member_ids()) and p.title like '[DCC] Post S1 — %'
    union
    select 'admin_task', t.status from kc_private.admin_tasks t where kc_private.demo_coverage_label() = any (t.labels)
    union
    select 'report', r.status from public.reports r where r.note like 'demo-coverage:%'),
  gaps as (
    select e.machine, e.status from expected e
     where not exists (select 1 from covered c where c.machine = e.machine and c.status = e.status))
  select jsonb_build_object(
    'wave', 1,
    'complete', not exists (select 1 from gaps),
    'gaps', coalesce((select jsonb_agg(jsonb_build_object('machine', g.machine, 'state', g.status)
                                       order by g.machine, g.status) from gaps g), '[]'::jsonb),
    'machines', (select jsonb_object_agg(x.machine, jsonb_build_object('expected', x.expected, 'covered', x.covered))
                   from (select e.machine, count(*) as expected,
                                count(*) filter (where not exists (
                                  select 1 from gaps g where g.machine = e.machine and g.status = e.status)) as covered
                           from expected e group by e.machine) x));
$$;
comment on function kc_private.demo_coverage_snapshot() is
  'Wave 1 coverage: per machine the expected and covered states, plus the states without a fixture.';
