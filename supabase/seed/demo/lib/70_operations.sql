-- Demo data (FR-ADMIN-031) · stepped operations.
--
-- A request from the app runs under a short statement timeout, too short for a whole wipe or
-- restore. Each operation is therefore a list of phases; one RPC call runs one phase and
-- records the next one in kc_private.demo_data_state, so the app calls the step RPC until it
-- answers `done`. The same driver runs a whole operation in one transaction for the command
-- line (load.sql, wipe.sql), which has no such timeout.

-- The phases of an operation, in order. A restore starts with a wipe, so it is idempotent.
create or replace function kc_private.demo_phases(p_operation text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_operation
    when 'wipe' then array['wipe_content', 'wipe_accounts']
    when 'seed' then array['wipe_content', 'wipe_accounts', 'members', 'items', 'rides', 'social', 'chats', 'orgs']
  end;
$$;

-- What exists right now (the status screen and the result of a restore).
create or replace function kc_private.demo_data_counts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with m as (select kc_private.demo_member_ids() as ids)
  select jsonb_build_object(
    'demo_users', cardinality(m.ids),
    'demo_organizations', (select count(*) from public.organizations o where o.id = any (kc_private.demo_org_ids())),
    'demo_item_posts', (select count(*) from public.posts p where p.owner_id = any (m.ids) and p.post_type <> 'ride'),
    'demo_ride_posts', (select count(*) from public.posts p where p.owner_id = any (m.ids) and p.post_type = 'ride'),
    'demo_follows', (select count(*) from public.follows f where f.follower_id = any (m.ids)),
    'demo_chats', (select count(*) from public.chats c
                    where c.kind = 'direct' and (c.direct_user_a = any (m.ids) or c.direct_user_b = any (m.ids))),
    'demo_org_memberships', (select count(*) from public.org_memberships om
                              where om.org_id = any (kc_private.demo_org_ids())))
    from m;
$$;
comment on function kc_private.demo_data_counts() is 'Counts of the demo data that exists now, by kind.';

-- Runs one phase without a caller identity: the rows belong to the demo members, so no
-- member quota, rate limit or "acting member" rule of the caller applies to them. The
-- caller's claims are put back afterwards for the audit row.
create or replace function kc_private.demo_run_phase(p_phase text, p_actor_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_claims constant text := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}');
  v_sub constant text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  v_out jsonb;
begin
  -- Both the claims document and the legacy single claim that auth.uid() may read.
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('kc.rate_limit_exempt', 'on', true);
  v_out := case p_phase
    when 'wipe_content' then kc_private.demo_wipe_content(kc_private.demo_member_ids())
    when 'wipe_accounts' then kc_private.demo_wipe_accounts(kc_private.demo_member_ids())
    when 'members' then jsonb_build_object('members_created', kc_private.demo_seed_members(
                          (select s.password_hash from kc_private.demo_data_state s)))
    when 'items' then jsonb_build_object('items_created', kc_private.demo_seed_items())
    when 'rides' then jsonb_build_object('rides_created', kc_private.demo_seed_rides())
    when 'social' then jsonb_build_object('follows_created', kc_private.demo_seed_social())
    when 'chats' then jsonb_build_object('chats_created', kc_private.demo_seed_chats())
    when 'orgs' then jsonb_build_object('organizations_created', kc_private.demo_seed_orgs(p_actor_id))
  end;
  if v_out is null then
    raise exception 'demo_phase_invalid' using errcode = 'P0001', detail = p_phase;
  end if;
  perform set_config('kc.rate_limit_exempt', '', true);
  perform set_config('request.jwt.claims', v_claims, true);
  perform set_config('request.jwt.claim.sub', v_sub, true);
  return v_out;
end;
$$;

-- Runs the next phase of `p_operation` ('seed' or 'wipe') and returns
--   { done: false, progress_key: <next phase> }   or   { done: true, progress_key: 'done', result: {…} }.
-- Another operation in progress refuses with demo_operation_busy, unless it stalled for ten
-- minutes (an app closed mid-way), in which case this one takes over. A restore needs the dev
-- marker (not_dev_environment) and a saved password (password_required).
create or replace function kc_private.demo_advance(p_operation text, p_actor_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_state kc_private.demo_data_state;
  v_phases constant text[] := kc_private.demo_phases(p_operation);
  v_phase text;
  v_aux jsonb;
  v_next text;
begin
  if v_phases is null then
    raise exception 'demo_operation_invalid' using errcode = 'P0001';
  end if;
  select s.* into v_state from kc_private.demo_data_state s where s.singleton for update;
  if p_operation = 'seed' and not coalesce(v_state.is_dev_environment, false) then
    raise exception 'not_dev_environment' using errcode = '42501';
  end if;

  if v_state.operation = p_operation then
    v_phase := v_state.phase;
    v_aux := v_state.aux;
  elsif v_state.operation = 'idle' or v_state.updated_at < now() - interval '10 minutes' then
    if p_operation = 'seed' and v_state.password_hash is null then
      raise exception 'password_required' using errcode = 'P0001';
    end if;
    v_phase := v_phases[1];
    v_aux := '{}'::jsonb;
  else
    raise exception 'demo_operation_busy' using errcode = 'P0001';
  end if;

  v_aux := v_aux || kc_private.demo_run_phase(v_phase, p_actor_id);
  v_next := v_phases[array_position(v_phases, v_phase) + 1];

  if v_next is null then
    update kc_private.demo_data_state
       set operation = 'idle', phase = 'idle', actor_id = null, aux = '{}'::jsonb, updated_at = now()
     where singleton;
    return jsonb_build_object('done', true, 'progress_key', 'done',
      'result', case p_operation when 'seed' then kc_private.demo_data_counts() else v_aux end);
  end if;
  update kc_private.demo_data_state
     set operation = p_operation, phase = v_next, actor_id = p_actor_id, aux = v_aux, updated_at = now()
   where singleton;
  return jsonb_build_object('done', false, 'progress_key', v_next);
end;
$$;
comment on function kc_private.demo_advance(text, uuid) is
  'Runs the next phase of a demo wipe or restore; returns done, the next phase, or the final result.';

-- Whole operations in one call, for the command line (no statement timeout there).
create or replace function kc_private.demo_run_all(p_operation text, p_actor_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  -- A stalled step of an earlier portal operation must not block the command line.
  update kc_private.demo_data_state
     set operation = 'idle', phase = 'idle', actor_id = null, aux = '{}'::jsonb
   where singleton;
  loop
    v_out := kc_private.demo_advance(p_operation, p_actor_id);
    exit when (v_out ->> 'done')::boolean;
  end loop;
  return v_out -> 'result';
end;
$$;
comment on function kc_private.demo_run_all(text, uuid) is
  'Runs a whole demo wipe or restore in one transaction (load.sql, wipe.sql).';
