# Automatic App Review submission

Issue #2725. App Review submission and public release are different operations.
The automatic path always leaves release type MANUAL. It never changes testers,
cancels another review, deploys production or enables a store-build variable.

## Sequence

1. Fixes pass normal review and CI, then reach the approved tagged PROD build
   lane. `PROD store build` records the exact successful iOS upload as a small
   non-secret log entry. Android failure does not invalidate a successful iOS
   proof job. The uploaded source is the gate-selected SHA, not necessarily the
   workflow event SHA.
2. Qualify that exact production-signed version/build. Inspect guest browsing
   on iPad, media denial without pressure, and notification consent and delivery
   boundaries on a physical device. A DEV simulator pass alone is insufficient.
   Keep actual screenshots, device data and reviewer notes private.
3. Add `docs/release/asc-qualified-candidate.json` through normal CI/CODEOWNERS
   review. Do not add a placeholder record. Its shape is:

   - `backend`: `prod`; `release_type`: `MANUAL`.
   - `source_sha`: the exact 40-character PROD app source commit, on main.
   - `version`: exact marketing version; `build_number`: exact build as a string.
   - `upload_run_id`: completed PROD store-build run with a successful
     `Record exact PROD iOS upload` job matching that source and build.
   - `notes_sha256`: SHA-256 of the exact bytes in
     `docs/store/app-review-notes.md`. Notes must be factual and reviewed.
   - `acceptance`: explicit true for `guest`, `media_denial`,
     `notification_consent`, `production_signed_binary`.
   - `evidence`: at least one reviewed `reviewed-device-candidate` entry with
     exact `version`, `build_number`, `source_sha`, `method` (`human-device`
     or `automated-device`), `device`, `os`, `checked_at`, `reviewed_by`, a
     private `evidence_url`, and `checks` including
     `notification_consent_delivery`. A legitimate human device test qualifies.
     No physical CI provider or fabricated successful run is required.
     The protected record is the review attestation, not the URL itself.
     Simulator evidence may support guest and media checks. The device entry
     covers the unresolved OS-consent and delivery boundary only.

4. Once that qualification-record commit is current main and its push CI
   succeeds, the automatic workflow validates provenance without ASC secrets.
   Only then does the existing `mobile-store` submission job get ASC credentials.
   The existing submit script independently requires the exact build to be VALID,
   stops on unavailable/ambiguous/foreign review state, and is idempotent for the
   same build already waiting. An unprocessed build stops visibly rather than
   selecting another build or waiting indefinitely. Normal workflow rerun may
   retry the same qualification commit while it remains current main.

No record or an unchanged record is a quiet no-op. A malformed or stale new record
is a visible failure before submission. A new candidate needs a new reviewed
record. No automatic cancellation and no automatic public publication exist.
The existing manual plan/submit workflow remains available with its safeguards.

## Limits

The automation is installed only after its workflow reaches main. A local green
script test, DEV merge or uploaded binary is not evidence of App Review submission.
A reviewed record is necessary to bind the actual tested binary and factual
notes to this automatic submission. It does not require a new CI provider.
A human device test with exact build identity and honest reviewed evidence can
satisfy notification acceptance; simulator screenshots can cover other relevant
checks. These candidate checks address the three unresolved Apple findings,
not a new blanket release policy. The existing CI/CODEOWNERS, VALID processing,
conflict checks and MANUAL release behavior remain the release protections.
The Apple remediation outcome stays open until the actual corrected candidate
has been qualified and Apple confirms the submission state.
