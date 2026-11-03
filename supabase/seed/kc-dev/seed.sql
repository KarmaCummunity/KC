-- KC dev fake data (Hebrew). DEV ONLY. All accounts use @seed.kc.test.
-- The seed itself lives in the database as public.kc_dev_seed_demo_data (migration 0592) so the
-- Admin Portal "Demo data" screen and this script run exactly the same code. Wipe with wipe.sql.
-- Idempotent: the function wipes the previous seed first.
-- Test login: any seed user email; the password is the E2E_SEED_PASSWORD secret,
-- passed in by the Seed KC dev workflow as the kc.seed_password setting.
begin;

-- refuse to run on anything that looks like prod (guard set by workflow/psql var)
do $$ begin
  if coalesce(current_setting('kc.seed_target', true), '') <> 'dev' then
    raise exception 'refusing to seed: set kc.seed_target=dev';
  end if;
  if coalesce(current_setting('kc.seed_password', true), '') = '' then
    raise exception 'refusing to seed: set kc.seed_password (E2E_SEED_PASSWORD secret)';
  end if;
end $$;

-- Mark this database as kc-dev and save the password hash for portal restores.
insert into public.kc_dev_demo_config (password_hash)
values (crypt(current_setting('kc.seed_password'), gen_salt('bf')))
on conflict (singleton) do update set password_hash = excluded.password_hash;

select public.kc_dev_seed_demo_data(password_hash) as seeded from public.kc_dev_demo_config;

commit;
