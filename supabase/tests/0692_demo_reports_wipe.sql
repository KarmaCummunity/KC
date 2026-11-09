-- 0692: demo reports survive status KPI; wipe removes seed-linked reports.

begin;
select plan(2);

select has_function('public', 'kc_dev_seed_demo_reports', array[]::text[], 'kc_dev_seed_demo_reports exists');

select is(
  (select public.kc_dev_wipe_next_step('chats')),
  'reports'::text,
  'wipe order includes reports after chats'
);

select * from finish();
rollback;
