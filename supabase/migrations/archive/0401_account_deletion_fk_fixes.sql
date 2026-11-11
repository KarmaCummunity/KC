-- 0401_account_deletion_fk_fixes | In-app account deletion (Apple 5.1.1(v)) must not be
-- blocked by FKs added after 0029. delete_account_data() deletes public.users; these
-- FKs had no ON DELETE action (or were NOT NULL), so any user with a donation, a
-- match run or an entity merge could not delete their account.
--
-- Money records are KEPT and de-identified (user_id -> NULL) rather than deleted:
-- payments / receipts may need to be retained for accounting (draft decision, see
-- docs/store/README.md). Standing orders keep ON DELETE CASCADE so charges stop.

begin;

create or replace function pg_temp.fk_set_null(p_table regclass, p_column text)
returns void
language plpgsql
as $$
declare
  v_con text;
begin
  select c.conname into v_con
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = p_table
     and c.contype = 'f'
     and c.confrelid = 'public.users'::regclass
     and a.attname = p_column
   limit 1;
  if v_con is not null then
    execute format('alter table %s drop constraint %I', p_table, v_con);
  end if;
  execute format('alter table %s alter column %I drop not null', p_table, p_column);
  execute format(
    'alter table %s add constraint %I foreign key (%I) references public.users(user_id) on delete set null',
    p_table, coalesce(v_con, replace(p_table::text, 'public.', '') || '_' || p_column || '_fkey'), p_column);
end;
$$;

select pg_temp.fk_set_null('public.donation_intents', 'user_id');
select pg_temp.fk_set_null('public.payments', 'user_id');
select pg_temp.fk_set_null('public.donation_receipts', 'user_id');
select pg_temp.fk_set_null('public.entity_merges', 'merged_by');
select pg_temp.fk_set_null('public.entity_merges', 'undone_by');
select pg_temp.fk_set_null('public.match_runs', 'triggered_by');

commit;
