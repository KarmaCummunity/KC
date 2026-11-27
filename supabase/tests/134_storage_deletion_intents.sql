-- Durable storage deletion intents (account purge): finishing a purge records one intent per folder
-- of the member in the same transaction, the intents survive the identity's cascade, a sweep closes
-- an intent only when its second listing was empty after the quiet window, anything else keeps it
-- open (errors back off), a stuck intent is reported, closed intents are pruned after 7 days, and no
-- client role can reach any of it.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(17);

insert into auth.users (id, email, raw_app_meta_data)
values ('00000000-0000-4000-8000-00000000000a', 'a@example.test', '{"provider":"google"}');
update public.user_account
   set status = 'pending_deletion', status_before_deletion = 'active',
       deletion_requested_at = now() - interval '31 days', deletion_purge_at = now() - interval '1 day'
 where user_id = '00000000-0000-4000-8000-00000000000a';

select lives_ok($$select kc_private.account_purge_prepare('00000000-0000-4000-8000-00000000000a')$$, 'the purge prepares');
select is(kc_private.account_purge_finish('00000000-0000-4000-8000-00000000000a'), true, 'finishing removes the identity');

create temp table mine as
  select * from kc_private.storage_deletion_intents where prefix like '%00000000-0000-4000-8000-00000000000a';
select is((select string_agg(bucket || ':' || prefix, ',' order by bucket, prefix) from mine),
  (select string_agg(b, ',' order by b) from (
     select id || ':00000000-0000-4000-8000-00000000000a' as b from storage.buckets
     union all select 'post-images:derived/00000000-0000-4000-8000-00000000000a') x),
  'one intent per folder of the member: their folder in every bucket and their photo copies');
select ok((select bool_and(reason = 'account_purge' and not_before = now() + interval '1 hour' and verified_absent_at is null) from mine),
  'each intent is open and may not close before the quiet window');
select is((select count(*)::integer from auth.users where id = '00000000-0000-4000-8000-00000000000a'), 0,
  'the identity and every row of the member are gone, the intents are not (no foreign key)');
select is((select count(*)::integer from kc_private.storage_deletion_intents_due(500) d where d.id in (select id from mine)),
  (select count(*)::integer from mine), 'every new intent is due for a first sweep');

-- One intent to drive through the states.
create temp table one as select id from mine where bucket = 'post-images' and prefix like 'derived/%';

select is(kc_private.storage_deletion_intent_swept((select id from one), 3, 0), 'pending',
  'empty after the sweep but inside the quiet window: stays open');
select ok((select next_sweep_at >= not_before and last_found = 3 and last_remaining = 0
             from kc_private.storage_deletion_intents where id = (select id from one)),
  'the next sweep is not before the window ends');
select is(kc_private.storage_deletion_intent_swept((select id from one), 0, 0, 'list HTTP 503'), 'retry',
  'a failed sweep backs off');
select is((select last_error from kc_private.storage_deletion_intents where id = (select id from one)), 'list HTTP 503',
  'the failure is recorded');

-- The quiet window passes (time moved by hand for the test).
update kc_private.storage_deletion_intents
   set not_before = created_at, created_at = created_at - interval '2 hours'
 where id = (select id from one);
select is(kc_private.storage_deletion_intent_swept((select id from one), 1, 1), 'pending',
  'after the window, a late object still listed keeps the intent open');
select is(kc_private.storage_deletion_intent_swept((select id from one), 1, 0), 'verified',
  'after the window, an empty second listing closes it');
select is(kc_private.storage_deletion_intent_swept((select id from one), 0, 0), 'unknown',
  'a closed intent is not swept again');

-- A stuck intent is reported; closed intents are pruned after a week.
delete from ops.warnings where key = 'storage_deletion_stuck';
update kc_private.storage_deletion_intents set sweeps = 4 where id = (select min(id) from mine where id <> (select id from one));
select is(kc_private.storage_deletion_intent_swept((select min(id) from mine where id <> (select id from one)), 2, 2), 'pending',
  'a fifth sweep that still finds objects');
select is((select count(*)::integer from ops.warnings where key = 'storage_deletion_stuck'), 1, 'is reported once in ops.warnings');

update kc_private.storage_deletion_intents set verified_absent_at = now() - interval '8 days' where id = (select id from one);
select is(kc_private.storage_deletion_intents_prune(), 1, 'one closed intent is older than 7 days');
select is((select count(*)::integer from kc_private.storage_deletion_intents where id = (select id from one)), 0,
  'it is deleted (its path holds a user id); the open ones stay');

select * from finish();
rollback;
