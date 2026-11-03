-- 0453 — D63 (docs/spec/07_cross_cutting_systems.md §7.6): listing handoffs
-- award the karma table values per world, from one config, once per handoff.

begin;

create or replace function pg_temp.assert(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERT FAILED: %', p_msg; end if;
end $$;

-- T1: the config matches the §7.6 table.
do $$
begin
  perform pg_temp.assert(public.karma_handoff_points('items', 'giver') = 20 and public.karma_handoff_points('items', 'receiver') = 15, 'items 20/15');
  perform pg_temp.assert(public.karma_handoff_points('food', 'giver') = 20 and public.karma_handoff_points('food', 'receiver') = 10, 'food 20/10');
  perform pg_temp.assert(public.karma_handoff_points('rides', 'giver') = 25 and public.karma_handoff_points('rides', 'receiver') = 10, 'rides 25/10');
  perform pg_temp.assert(public.karma_handoff_points('knowledge', 'giver') = 5 and public.karma_handoff_points('knowledge', 'receiver') = 3, 'unpriced world keeps 5/3');
  raise notice '✓ T1 karma config per world';
end $$;

-- T2: an award credits both sides once, even if completion runs twice.
do $$
declare
  v_giver uuid := gen_random_uuid();
  v_receiver uuid := gen_random_uuid();
  v_handoff uuid := gen_random_uuid();
  u uuid;
begin
  foreach u in array array[v_giver, v_receiver] loop
    insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
    values (u, 'k453_' || substr(u::text, 1, 8) || '@test.local', now(), '{}'::jsonb,
            jsonb_build_object('provider', 'email'), 'authenticated', 'authenticated');
    update public.users set karma_points = 0 where user_id = u;
  end loop;

  perform public.karma_award_handoff(v_giver, v_receiver, 'food', v_handoff);
  perform public.karma_award_handoff(v_giver, v_receiver, 'food', v_handoff);

  perform pg_temp.assert((select karma_points from public.users where user_id = v_giver) = 20, 'giver did not get 20 once');
  perform pg_temp.assert((select karma_points from public.users where user_id = v_receiver) = 10, 'receiver did not get 10 once');
  raise notice '✓ T2 award once per handoff';
end $$;

-- T3: no handoff completion still hard-codes the old 5 / 3 award.
do $$
begin
  perform pg_temp.assert(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname not in ('karma_award_handoff', 'karma_grant_once')
       and p.prosrc like '%karma_grant_once(%''giving_handoff_giver''%'), 'a function still grants giving_handoff_giver directly');
  raise notice '✓ T3 every completion awards through the config';
end $$;

rollback;

\echo '✓ 0453_handoff_karma_per_spec.sql passed'
