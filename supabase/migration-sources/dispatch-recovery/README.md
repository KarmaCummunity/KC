# Dispatch recovery migration sources

These are the authoritative modules of the forward-only dispatch recovery migration.
They are outside `supabase/schemas`, which is the frozen source of released migration
`0001_baseline.sql`. Do not regenerate or add dispatch CREATE statements to that baseline.

The pending migration `next-01_edge_invocation_apikey.sql` is the exact concatenation of
these modules, preceded by its one-line generated header. Update source and migration
together. `scripts/dispatch-schema-parity.test.mjs` verifies byte-for-byte parity both
before and after the existing merge-time numbering route assigns the migration number.
Each module stays below the repository's 300-line cap.

Run `node scripts/migration-ids.mjs assign` only in a disposable checkout for local DB
qualification. The existing CI and merge workflow assign the pending filename and append
its numbered name to the inventory manifest. Inventory does not change production mode;
production remains blocked by default and requires separate approval.

Fresh reset applies unchanged baseline plus forward migrations. Upgrade qualification
starts at the actual current DEV schema, then applies only this new forward migration.
Both must pass without duplicate CREATE statements or changes to baseline/guard policy.
