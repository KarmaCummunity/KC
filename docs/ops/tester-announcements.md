# Tester update announcements

DEV TestFlight uploads keep the existing external groups, KC Beta and KC Real Users. The distribution script disables buildBetaDetails.autoNotifyEnabled and independently reads false back before assigning groups or submitting Beta App Review. It checks the setting again afterward. Missing or contradictory evidence fails the distribution step, while an earlier upload can still have succeeded.

There is no automatic Notify Testers, invitation resend, email, WhatsApp or broadcast step. Do not add an announcement override to this workflow. A later announcement is a separate explicit choice, not implied by upload, approval or a passing build.

This policy does not disable ordinary application notifications or change notification jobs. Temporary DEV outbound containment is independent. It does not change beta-group membership, public links, the PROD upload-only path or App Store release behavior.

## Apple availability limit

Apple documents that deselecting Automatically notify testers can require manual distribution after Beta App Review. Its Notify Testers action changes the build to Testing and sends a notification. Therefore disabling auto-notify, assigning groups or obtaining approval is not proof that the new build is available for silent external automatic updates. Report the actual externalBuildState. Do not call an approved-not-notified build distributed, and do not invoke Notify Testers merely to make a build available under the silent-update instruction.

Apple admin review-result messages and tester-controlled TestFlight settings are not certified suppressed by this build-level flag. Verify the exact build through App Store Connect before claiming silent availability. If Apple cannot provide it, preserve no-announcement behavior and explain that availability constraint rather than silently sending.

Sources:
- https://developer.apple.com/documentation/appstoreconnectapi/buildbetadetail/attributes-data.dictionary
- https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-buildbetadetails-_id_
- https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/
