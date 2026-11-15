-- kc_test core | Shared harness for DB tests (G38): actor switching and assertions.
--
-- Installed by scripts/run-db-tests.sh into a throwaway `kc_test` schema on the LOCAL
-- Supabase stack only, before any file under supabase/tests/ runs. It is never part of
-- supabase/migrations/, so it can never reach kc-dev or production.
--
-- Conventions (see supabase/tests/_harness/README.md):
--   * Every test file runs inside `begin; … rollback;` — the harness never commits data.
--   * Assertion failures raise `ASSERT FAILED: <message>` so psql (ON_ERROR_STOP) stops.

drop schema if exists kc_test cascade;
create schema kc_test;
comment on schema kc_test is 'Local-only DB test harness (supabase/tests/_harness). Never migrated.';

-- ── Actors ────────────────────────────────────────────────────────────────────
-- Tests run as the postgres superuser; RPCs resolve the caller from auth.uid(), which
-- reads the transaction-local JWT claims set here. RLS itself is not enforced by these
-- helpers (that is the RLS persona suite's job, INFRA-QA-W3).

create function kc_test.act_as(p_user_id uuid)
returns void
language sql
as $$
  select set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_user_id, 'role', 'authenticated')::text,
    true);
$$;

create function kc_test.act_as_anon()
returns void
language sql
as $$
  select set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
$$;

-- ── Assertions ────────────────────────────────────────────────────────────────

create function kc_test.fail(p_message text)
returns void
language plpgsql
as $$
begin
  raise exception 'ASSERT FAILED: %', p_message;
end;
$$;

create function kc_test.assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  -- NULL counts as failure: an unknown result is never a passing assertion.
  if p_condition is distinct from true then
    perform kc_test.fail(p_message);
  end if;
end;
$$;

-- Compared as text so one function serves every scalar type without overload noise.
create function kc_test.assert_eq(p_actual anyelement, p_expected anyelement, p_message text)
returns void
language plpgsql
as $$
begin
  if p_actual is distinct from p_expected then
    perform kc_test.fail(format('%s — expected %s, got %s',
      p_message, coalesce(p_expected::text, 'NULL'), coalesce(p_actual::text, 'NULL')));
  end if;
end;
$$;

-- Runs p_sql and requires it to raise an error whose message equals p_expected_error
-- (the domain error codes our RPCs raise, e.g. 'seats_exhausted'). Any other outcome —
-- success, or a different error — fails the test. Harness failures are re-raised as-is.
create function kc_test.assert_raises(p_sql text, p_expected_error text, p_message text)
returns void
language plpgsql
as $$
declare
  v_error text;
begin
  begin
    execute p_sql;
  exception when others then
    v_error := sqlerrm;
  end;

  if v_error is null then
    perform kc_test.fail(format('%s — expected error %s, but the statement succeeded',
      p_message, p_expected_error));
  elsif v_error <> p_expected_error then
    perform kc_test.fail(format('%s — expected error %s, got %s',
      p_message, p_expected_error, v_error));
  end if;
end;
$$;

-- Counts the rows returned by p_sql (any SELECT) and compares with p_expected.
create function kc_test.assert_row_count(p_sql text, p_expected bigint, p_message text)
returns void
language plpgsql
as $$
declare
  v_count bigint;
begin
  execute format('select count(*) from (%s) as q', p_sql) into v_count;
  perform kc_test.assert_eq(v_count, p_expected, p_message);
end;
$$;

-- ── Time ──────────────────────────────────────────────────────────────────────

-- ISO-8601 UTC string, the format listing `details` timestamps are stored in.
create function kc_test.iso_in(p_offset interval)
returns text
language sql
stable
as $$
  select to_char((now() + p_offset) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
$$;
