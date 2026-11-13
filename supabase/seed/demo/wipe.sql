-- Deletes the kc-dev demo data (FR-ADMIN-031): the demo members with everything they own and
-- the [DEMO] nonprofits, the same phases as the portal's "Delete all demo data". Needs
-- install.sql to have run. DEV ONLY; refuses unless kc.seed_target = 'dev'.
-- Run: psql --single-transaction -f wipe.sql
do $$
begin
  if coalesce(current_setting('kc.seed_target', true), '') <> 'dev' then
    raise exception 'refusing to wipe demo data: set kc.seed_target=dev';
  end if;
end $$;

select 'demo data wiped' as what, kc_private.demo_run_all('wipe') as result;
