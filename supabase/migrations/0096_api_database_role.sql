-- The database user of KC's own API server (ADR-009 phase 2).
--
-- The API replaces the request layer in front of the database, so it connects the way that
-- layer does: as a role that holds nothing itself and takes, for each transaction, the role of
-- the caller it authenticated (`anon`, `authenticated`) or, for the server's own work (scheduled
-- jobs, provider webhooks), `service_role`. `noinherit` is what makes that true: until it
-- switches role it can read and write nothing, so a query the API forgot to scope fails instead
-- of running with someone's rights.
--
-- No password is set here, and a role without one cannot sign in. A person sets it once per
-- environment, outside any migration, so that it is never in the repository (KC#2584).

do $$
begin
  -- `create role` has no IF NOT EXISTS, and roles belong to the whole server, not to one database.
  if not exists (select 1 from pg_roles where rolname = 'kc_api') then
    create role kc_api login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$$;

-- May switch to each of the three roles (`set`), and has none of their rights without switching (`inherit false`).
grant anon, authenticated, service_role to kc_api with inherit false, set true;

comment on role kc_api is
  'The KC API server''s database user (ADR-009). Holds no rights itself: each transaction switches to anon, authenticated or service_role.';
