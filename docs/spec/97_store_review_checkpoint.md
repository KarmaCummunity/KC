# Store review checkpoint, 2026-11-19

This is a dated status and source record, not the full project book, PRD or SRS. It does not mark unimplemented requirements complete. The [book index](./README.md), [requirements](./requirements/) and `PRD_V2_NOT_FOR_MVP/` remain separate sources. No requirement is deleted or consolidated by this checkpoint.

## Owner decisions made today

KC has a social purpose. The owner described its commercial model as future work: a full management platform for organizations and a personal WhatsApp bot with a few specific functions for individuals. No price or start date was newly confirmed. Historical D143 and SSOT D-210 price plans are not treated as cancelled, but their original user approval has not been recovered in this review.

The owner approved limited guest browsing as described in D178, tracked in [#2511](https://github.com/KarmaCummunity/KC/issues/2511). This is an audience change from the old member-only policy. It is not permission to publish a store version, send an Apple response or change production.

## Apple, verified live

- App: Karma Community, app ID 6827642867.
- Submission 4f86322a-0b37-4c2e-866a-bcb604f87151, submitted November 17, reviewed November 19. Status Rejected / Unresolved Issues.
- Version 1.0, binary 1.9.176 (36), reviewed on iPad Air 11-inch (M3).
- Guideline 5.1.1(v): registration is required before any content; Apple asks for non-account-based features to be accessible without registration. Account-based actions may still require login.
- Guideline 2.1(b): Apple asks who subscribes, where subscriptions are purchased, which prior subscriptions the app recognizes, and which non-IAP paid content/features are unlocked.
- KC Pro Monthly and KC Organization Monthly both exist as monthly products in group KC Pro. The products and group are Prepare for Submission, not approved for sale.

Sources:
- [Exact review submission](https://appstoreconnect.apple.com/apps/6827642867/distribution/reviewsubmissions/details/4f86322a-0b37-4c2e-866a-bcb604f87151)
- [Subscription group](https://appstoreconnect.apple.com/apps/6827642867/distribution/subscription-groups/22521796)
- [Build 36 metadata](https://appstoreconnect.apple.com/teams/3a825a1a-0b43-487a-9ba4-1ab24a88f553/apps/6827642867/testflight/ios/1f562803-3ed6-46c8-a0e9-c4c0591ee97d/metadata)

Build 36 was uploaded November 17 at 11:49 AM and its original filename is `df9dd29b-083d-4aaa-b489-f0f43a9b7172.ipa`. Its backend environment, source commit and build profile have not yet been bound to a verified build record. Do not infer them from the production APNs entitlement or from the version name.

A nearby [Mobile nightly run](https://github.com/KarmaCummunity/KC/actions/runs/44022749289/job/133838079918) used nightly/dev and built number 35, not 36. It is not evidence for the reviewed binary.

Current production configuration was checked read-only on November 19: money flags are absent (off under current flag semantics), and `billing.payment_providers` has no rows. Code at version 1.9.176 gates Pro behind an off-default feature flag. These facts are not proof of build 36's configuration or of the absence of external subscription arrangements. No Apple reply, resubmission or release has been performed as part of this checkpoint.

## Google Play, verified live

- App: KC - קהילת קארמה, package `org.karmacommunity.app`.
- Production inactive. Closed-test release published; only 2 testers currently opted in. Console requires at least 12 testers and a closed test with at least 12 for at least 14 days. [#2305](https://github.com/KarmaCummunity/KC/issues/2305) is still open work.
- Closed Alpha is active: 1.7.228 (code 8), released November 8, full rollout in 178 countries/regions.
- Internal testing has 1.9.176 (code 18), updated November 17. It is not the version on Closed Alpha.
- Eligibility is via the configured Google Group. Membership is required before opting in with the same Google account. Feedback URL/email is blank.
- Existing web opt-in link: https://play.google.com/apps/testing/org.karmacommunity.app
- Existing Android link: https://play.google.com/store/apps/details?id=org.karmacommunity.app

Sources:
- [App dashboard](https://play.google.com/console/u/0/developers/7243079991536393959/app/4974326588247524344/app-dashboard)
- [Closed Alpha testers](https://play.google.com/console/u/0/developers/7243079991536393959/app/4974326588247524344/tracks/4701162525780032266?tab=testers)
- [Releases overview](https://play.google.com/console/u/0/developers/7243079991536393959/app/4974326588247524344/releases/overview)

No invitations, tester enrollment, track changes or production-access application were made during this inspection. Trader-status declaration is a later account-owner task shown by the console, due February 2027; it is not today's blocker.

## Development and release safety

[#2510](https://github.com/KarmaCummunity/KC/pull/2510), fixing routine Vault preservation, is Draft. Draft intentionally skips the full CI gate. Its release is waiting for a separate safe-CI decision; no unchanged rerun is expected to fix this policy result. Other dev PRs are temporarily held as Draft to avoid another unsafe deployment. No label, branch protection, main or production change is authorized by this document.

Release-policy statements in `docs/agents/RELEASE.md`, `docs/SSOT/RELEASE_CHECKLIST.md`, `docs/SSOT/ENVIRONMENTS.md` and `docs/release/WEEKLY-RELEASE-TRAIN.md` disagree. Reconcile those statements against original owner decisions and current workflow behavior, rather than treating any document as a fresh grant to deploy.

## Owner authorization and safety checkpoint, 2026-11-19

At 18:43 Jerusalem the owner directly answered the proposal to disable the Sunday production train by approving smart automatic deployment instead. This authorizes the scheduled, gated dev-to-main-to-production path, not an immediate dispatch, skipped tests, bypassed failed checks, direct main pushes, unrelated settings changes, or release of unready PRs. Apple replies, App Store review submission and Play public promotion still require separate approval. Earlier broad statements about mandatory manual approval are qualified only for this scheduled path.

The enabled switch remains unchanged. The next scheduled run is Sunday November 22 at 06:00 Jerusalem. The owner approval settles authority, not implementation safety: #2509 is a known technical blocker. The existing routine deploy workflow can still overwrite the database jobs' Vault configuration. Draft PR holds do not stop release of the existing dev tip. Do not mark the train safe until a fail-closed check or the preservation fix is verified in the workflow copy that will actually execute. #2510 remains Draft pending a safe full-CI route. No main promotion or production run was performed in this checkpoint.
