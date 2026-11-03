# DB test harness (`kc_test`)

Shared helpers for every DB test (`docs/architecture/target.md` §5.1, gap G38). The files here are installed into a throwaway `kc_test` schema on the **local** Supabase stack by `scripts/run-db-tests.sh`; they are never part of `supabase/migrations/`.

## Run

```bash
supabase start                                   # local stack, all migrations
scripts/run-db-tests.sh                          # harness + every test
scripts/run-db-tests.sh supabase/tests/flows/rides_lifecycle.sql   # selected files
```

The connection comes from `supabase status` (or a `DB_URL` override), so no credential lives in the repo. The runner refuses any host but `127.0.0.1` / `localhost` / `[::1]`.

## Files

| File | Contents |
|---|---|
| `00_core.sql` | `act_as(user)`, `act_as_anon()`, `fail`, `assert_true`, `assert_eq`, `assert_raises(sql, error)`, `assert_row_count(sql, n)`, `iso_in(interval)` |
| `10_fixtures.sql` | world-agnostic builders: `create_user(handle)`, `create_listing(...)`, `listing_kind_id`, `listing_status`, `handoff_status` |
| `20_world_<slug>.sql` | one per giving world, composing the generic fixtures (`20_world_rides.sql`: `create_ride_offer`, `book_ride`) |

## Writing a test

- Wrap the file in `begin; … rollback;` and end with `\echo '✓ <file> passed'`.
- Create personas with `kc_test.create_user` (never hard-coded UUIDs); keep them in a temp table when several `DO` blocks need them.
- Switch the caller with `kc_test.act_as` before every RPC; assert domain errors with `kc_test.assert_raises(sql, 'error_code', 'why')`.
- `act_as` sets `auth.uid()` only; RLS is not enforced (that is the RLS persona suite, INFRA-QA-W3).

## Adding a giving world

1. `20_world_<slug>.sql` with the world's builders.
2. `supabase/tests/flows/<slug>_lifecycle.sql`: the full lifecycle plus every guard, one `DO` block per stage.
3. `flows/harness_selftest.sql` must stay green: it proves each assertion fails when it should.
