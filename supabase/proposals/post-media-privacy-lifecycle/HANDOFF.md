# Media branch handoff — `claude/media-perf-upload-display-jyts8v`

Base: `origin/dev` at `c3873b028d99eb94e7171fb50fb3c5bfaf06930f`. No PR, no merge, nothing deployed,
scheduled or applied to any shared database. The full commit list is in the final session report and
in `git log c3873b02..HEAD`.

## Two separable parts

1. **App / web-edge (client checkpoint)** — `app/**` only:
   - upload pipeline: single decode, abortable fetch uploads, per-attempt paths, device ledger;
   - avatar generation lifecycle;
   - fail-closed link-preview image check;
   - thumb-first feed; storage transforms opt-in;
   - owner-only pending cover.
2. **Server candidate** — `supabase/**` only, unscheduled:
   - migration `next-01_post_media_sanitized_derivative.sql`;
   - worker `process-post-media`;
   - purge changes;
   - pgTAP `128`–`131`.

Integrate the parts separately if wanted.

## How the tests were run (local only)

- **pgTAP:** a local PostgreSQL 16 + PostGIS + pgTAP. Copy the `next-01` migration to a scratch
  `9999_*.sql`, run `DB_URL=postgresql://postgres@127.0.0.1:<port>/postgres scripts/run-baseline-tests.sh <tests>`,
  then delete the copy. The local shim grants `storage.objects` to `service_role`, as assumed of the platform.
- **Edge Functions:** Deno 2.5.6 (the CI pin), from `supabase/functions`: `deno check .`, `deno lint`,
  `deno test --allow-read`.
- **App:** from `app/`: `pnpm typecheck`, `pnpm lint`; mobile `npx vitest run`;
  web-edge `node --test test/*.test.mjs`.
- **Last full-suite runs**, all before later fixes, so stale for HEAD:
  - mobile 516 files / 4331 tests at `c870903b`;
  - Edge Functions 770 at `258e2e01`;
  - pgTAP 99 files / 2966 ok at `715fd592`.
- **Since then:** only affected suites. A final full-gate run on the exact HEAD is still owed.

## Open blockers (none closed by passing tests alone)

1. **Public pending/share (#2316) is still open** until the server step runs safely on DEV with a
   real consumer and cleanup smoke.
2. **Resources unqualified on the platform.**
   - Local-only samples so far.
   - Decode/encode cannot be interrupted.
   - A job's operation deadlines add up to about 70 s plus decode, while the 20 s budget only gates
     the next claim.
   - The `dev-experiment-1024` profile exists to sample this. Running it is an activation step.
3. **Originals stay public; copies are not revocable** (public, immutable CDN URLs). Design in `DESIGN.md`.
4. **Deletion is application-level only.**
   - No commit-time storage authorization for service writes.
   - Aborted uploads may still commit.
   - The cancelled job rows cascade away, so there is no durable deletion intent.
   - No verified re-sweep.
5. **No server reconciliation for `chat-media` / `avatars`.** The device ledger is best effort:
   swept on the next upload, capped at 200 entries, and its 15-minute settle window is assumed, not
   measured.
6. **Not verified live:** storage-api policy behaviour (the `derived/` fence), metadata size/type as
   the completion check reads them, late-commit timing, RN `File.bytes()` on devices, WhatsApp
   rendering, native performance.
7. **A security point** found while reviewing the baseline storage policies was reported to the PM
   privately (not described here, per AGENTS.md §7).

## Gated activation steps (each needs owner + manager approval)

Merge to `dev` → Deploy applies the migration and deploys the worker (unscheduled) → DEV smoke with a
test account and synthetic images (optionally the experiment profile) → a separate migration to
schedule → a separate decision on existing pending rows.
