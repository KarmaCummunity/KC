# Frozen dry-run runner test inputs

`reviewed-db-inputs-2120.json.gz` is deterministic gzip (mtime zero) of UTF-8 JSON:
`{sourceCommit, blobs: {repositoryPath: exactUtf8Content}}`.

Source commit: `21207a0157d98ad8ac248cbf704894ddc9a94656`.
Contains only the reviewed manifest, Supabase config and the 79 migration SQL files
named in RELEASE_PLAN. No environment values, database data or credentials.
Archive SHA-256: `59499218c7ec1a0e177697b18fe6fcd8af80e24dc4dbd87979cb357c81020b54`.

The tests independently compare every uncompressed blob hash with RELEASE_PLAN.
This isolates the mock candidate from the current checkout's later migrations and
works with shallow CI checkout. It does not qualify a newer production candidate.
The real runner still reads actual candidate git blobs and rejects drift. Do not
refresh RELEASE_PLAN or this fixture merely to make a changed DB candidate pass.

Re-qualified 2026-11-22 for release v1.9.28x: PROD ledger 0001–0069 (55 versions), 24 pending
0070–0093, each reviewed in the release PR (Migration safety lines for the DROP FUNCTION findings).
