-- 0446 — D24: ratings are readable by their rater and super admins only.
-- Asserts the SELECT policy shape on both rating tables: no policy grants
-- `anon`, none references the ratee / handoff counterpart, and each keeps the
-- rater + admin branches.

create or replace function pg_temp.assert(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERT FAILED: %', p_msg; end if;
end $$;

do $$
declare
  v_table text;
  v_total integer;
  v_leaky integer;
  v_shape integer;
begin
  foreach v_table in array array['ride_ratings', 'giving_handoff_ratings'] loop
    select count(*) into v_total
      from pg_policies
     where schemaname = 'public' and tablename = v_table and cmd in ('SELECT', 'ALL');
    perform pg_temp.assert(v_total >= 1, format('%s: no SELECT policy', v_table));

    -- Any SELECT policy that lets the ratee / counterpart or anon read.
    select count(*) into v_leaky
      from pg_policies
     where schemaname = 'public' and tablename = v_table and cmd in ('SELECT', 'ALL')
       and (qual like '%ratee_id%' or qual like '%recipient_id%' or qual like '%owner_id%'
            or 'anon' = any (roles) or 'public' = any (roles));
    perform pg_temp.assert(v_leaky = 0,
      format('%s: SELECT policy exposes ratings beyond rater/admin (%s found)', v_table, v_leaky));

    -- Every SELECT policy is the rater-or-admin shape.
    select count(*) into v_shape
      from pg_policies
     where schemaname = 'public' and tablename = v_table and cmd in ('SELECT', 'ALL')
       and qual like '%rater_id%' and qual like '%has_admin_role%';
    perform pg_temp.assert(v_shape = v_total,
      format('%s: %s of %s SELECT policies are not rater-or-admin', v_table, v_total - v_shape, v_total));
  end loop;
end $$;

\echo '✓ 0446_ratings_visible_to_rater_and_admins_only.sql passed'
