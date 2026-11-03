-- Test harness: lift the 0534 hourly write caps for the local test database.
-- Fixture-heavy tests create many listings, handoffs and follows as one persona
-- within seconds; the caps themselves are covered by tests/0534_write_rate_limits.sql,
-- which lowers them inside its own rolled-back transaction.
update public.marketplace_rule_params
   set param_value = '100000'
 where rule_code in ('R-SEC-Listing-Write', 'R-SEC-Handoff-Write', 'R-SEC-Follow-Write')
   and param_key = 'max_per_hour';
