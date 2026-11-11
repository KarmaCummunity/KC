-- Foundation: schemas exist, client roles are locked out of the private ones, and nothing
-- created in `public` is reachable by a client role until it is granted explicitly.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(27);

-- ── Schemas ─────────────────────────────────────────────────────────────────
select has_schema(s, format('schema %s exists', s))
  from unnest(array['kc_private', 'billing', 'audit', 'integrations', 'ops']) as s;

select ok(
         not has_schema_privilege(r, s, 'usage'),
         format('%s cannot use schema %s', r, s))
  from unnest(array['kc_private', 'billing', 'audit', 'integrations', 'ops']) as s
 cross join unnest(array['anon', 'authenticated']) as r;

select ok(
         has_schema_privilege('service_role', s, 'usage'),
         format('service_role can use schema %s', s))
  from unnest(array['kc_private', 'billing', 'audit', 'integrations', 'ops']) as s;

-- ── Default privileges in `public` ──────────────────────────────────────────
-- A new table or function must start with no client access at all.
create table public.baseline_probe (id integer primary key);
create function public.baseline_probe_fn() returns integer language sql as 'select 1';

select ok(
         not has_table_privilege(r, 'public.baseline_probe', 'select, insert, update, delete'),
         format('%s has no privilege on a new public table', r))
  from unnest(array['anon', 'authenticated']) as r;

select ok(
         not has_function_privilege(r, 'public.baseline_probe_fn()', 'execute'),
         format('%s cannot execute a new public function', r))
  from unnest(array['anon', 'authenticated']) as r;

select ok(
         has_function_privilege('service_role', 'public.baseline_probe_fn()', 'execute'),
         'service_role can execute a new public function');

-- ── Shared trigger function ─────────────────────────────────────────────────
select ok(
         not has_function_privilege('authenticated', 'kc_private.set_updated_at()', 'execute'),
         'authenticated cannot execute the trigger function');

create table public.baseline_probe_rows (
  id integer primary key,
  note text,
  updated_at timestamptz not null default '2000-01-01T00:00:00Z'
);
create trigger baseline_probe_rows_set_updated_at
  before update on public.baseline_probe_rows
  for each row execute function kc_private.set_updated_at();

insert into public.baseline_probe_rows (id, note) values (1, 'before');
update public.baseline_probe_rows set note = 'after' where id = 1;

select is(
         (select updated_at from public.baseline_probe_rows where id = 1),
         now(),
         'set_updated_at stamps the transaction time on update');

select * from finish();
rollback;
