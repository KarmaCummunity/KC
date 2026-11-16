-- Demo data on kc-dev (FR-ADMIN-031). DEV ONLY.
--
-- Installs the demo-data tools (install.sql), marks this database as the dev environment, the
-- only place a restore may run (AC8), and, when a password is given, restores the demo data
-- with it at once: the same phases the portal's "Restore demo data" runs, so the screen and
-- this script share one source of truth. Without a password the restore is left to the portal.
--
-- Session settings the caller sets first (the Seed KC dev workflow does):
--   kc.seed_target   = 'dev'     (required)
--   kc.seed_password = optional: the demo members' login password; only its bcrypt hash is stored
-- Run: psql --single-transaction -f load.sql
do $$
begin
  if coalesce(current_setting('kc.seed_target', true), '') <> 'dev' then
    raise exception 'refusing to install demo data tools: set kc.seed_target=dev';
  end if;
end $$;

\ir install.sql

update kc_private.demo_data_state set is_dev_environment = true where singleton;

update kc_private.demo_data_state
   set password_hash = extensions.crypt(current_setting('kc.seed_password'), extensions.gen_salt('bf'))
 where singleton and coalesce(current_setting('kc.seed_password', true), '') <> '';

select 'demo data' as what, kc_private.demo_run_all('seed') as result
 where coalesce(current_setting('kc.seed_password', true), '') <> '';
