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
   - `evidence`: at least one reviewed `physical-ios-candidate` entry with
     exact `version`, `build_number`, `source_sha`, a successful same-repository
     evidence `run_id` and its exact `head_sha`, and a private `evidence_url`.
     This is a protected reviewer attestation backed by a successful evidence
     run, not a claim that any successful run proves physical-device behavior.
     Do not use this field for a simulator run or invent a physical evidence run.

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
A reviewed record is necessary because no existing unattended physical-device
acceptance provider is configured here. Do not fabricate that missing evidence.
The Apple remediation outcome stays open until the actual corrected candidate
has been qualified and Apple confirms the submission state.
