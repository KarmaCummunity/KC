# Frozen dry-run runner test inputs

`reviewed-db-inputs-67aa.json.gz` is deterministic gzip (mtime zero) of UTF-8 JSON:
`{sourceCommit, blobs: {repositoryPath: exactUtf8Content}}`.

Source commit: `67aa4c6755da0bc43e1b30a80379ad7feba834be`.
Contains only the reviewed manifest, Supabase config and the 75 migration SQL files
named in RELEASE_PLAN. No environment values, database data or credentials.
Archive SHA-256: `d58b65937add5fca8e1b4f1e0ce858f3afb2cb2dbf5340254c2a8476e33e84b0`.

The tests independently compare every uncompressed blob hash with RELEASE_PLAN.
This isolates the mock candidate from the current checkout's later migrations and
works with shallow CI checkout. It does not qualify a newer production candidate.
The real runner still reads actual candidate git blobs and rejects drift. Do not
refresh RELEASE_PLAN or this fixture merely to make a changed DB candidate pass.
