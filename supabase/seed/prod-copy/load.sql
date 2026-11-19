-- Production copy tools on kc-dev (FR-ADMIN-037). DEV ONLY.
--
-- Installs the tools (install.sql) and marks this database as the dev environment, the only
-- place a copy may be applied (kc_private.prod_copy_apply refuses elsewhere). Copies nothing.
--
-- Session setting the caller sets first (deploy-db.yml does on every dev deploy):
--   kc.seed_target = 'dev'   (required)
-- Run: psql --single-transaction -f load.sql
do $$
begin
  if coalesce(current_setting('kc.seed_target', true), '') <> 'dev' then
    raise exception 'refusing to install production copy tools: set kc.seed_target=dev';
  end if;
end $$;

\ir install.sql

update kc_private.prod_copy_state set is_dev_environment = true, updated_at = now() where singleton;
