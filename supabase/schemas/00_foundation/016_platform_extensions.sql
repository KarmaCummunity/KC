-- Foundation · platform extensions (design §4 "Secrets", §6, §7)
--
-- The three Supabase platform extensions the product runs on:
--   pg_cron         the scheduler behind kc_private.scheduled_jobs (95_platform/040)
--   pg_net          asynchronous HTTP, used to start Edge Functions (95_platform/050)
--   supabase_vault  encrypted secrets (kc_project_url, kc_service_role_key)
--
-- On a Supabase project they are required: this file creates them and a failure stops the
-- migration, so a project that cannot run the product never ends up half built. A Supabase
-- server is recognised by its `supabase_admin` role. On a plain PostgreSQL server (the local
-- test harness) each one is created only when the server has it; the modules that use them
-- degrade to a recorded warning (`ops.warnings`) instead of failing.
--
-- pg_cron can only live in the database named by `cron.database_name` (`postgres` on
-- Supabase). The scratch databases the test runner creates on a Supabase stack are another
-- database, so there pg_cron is skipped with a notice.

do $$
declare
  v_platform constant boolean := exists (select 1 from pg_catalog.pg_roles where rolname = 'supabase_admin');
  v_cron_db constant text := coalesce(nullif(current_setting('cron.database_name', true), ''), 'postgres');
begin
  -- pg_cron
  if v_platform and current_database() = v_cron_db then
    create extension if not exists pg_cron;
  elsif exists (select 1 from pg_catalog.pg_available_extensions e where e.name = 'pg_cron')
        and current_database() = v_cron_db then
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise notice 'pg_cron is installed but not loadable in this database: jobs are registered, not scheduled';
    end;
  else
    raise notice 'pg_cron is not used in database %: jobs are registered, not scheduled', current_database();
  end if;

  -- pg_net (creates the `net` schema itself) and Vault (creates the `vault` schema).
  if v_platform then
    create extension if not exists pg_net with schema extensions;
    create extension if not exists supabase_vault;
  else
    if exists (select 1 from pg_catalog.pg_available_extensions e where e.name = 'pg_net') then
      create extension if not exists pg_net with schema extensions;
    end if;
    if exists (select 1 from pg_catalog.pg_available_extensions e where e.name = 'supabase_vault') then
      create extension if not exists supabase_vault;
    end if;
  end if;
end $$;
