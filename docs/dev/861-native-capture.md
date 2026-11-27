# #861 native visual evidence capture, preparation only

This additive change retains three explicit PNG captures during the next existing Android
Maestro run. It does not start a build, add a flow/consumer, change assertions, enable a
provider or restart an in-flight run. Review and normal CI are required before use.

## What the existing run can supply

- Feed capture is HELD: the signed-in E2E identity does not prove feed content synthetic.
  No explicit feed screenshot until its pixel content is grounded safe before upload.
- Create form, after `unified-create-header` and `create-post-screen` are visible.
- Edit-profile phone input focused, with save CTA visible. This is not labeled keyboard
  proof until an image actually shows the keyboard and its bounds are inspected.
- Same profile state after keyboard dismissal.

The runner supplies a per-attempt `--test-output-dir` below its existing output directory.
Screenshot paths are relative. Captures default off for direct developer flows. The runner
enables KC_NATIVE_CAPTURE_SAFE only for user1@seed.kc.test (the existing synthetic default);
any other identity keeps explicit success captures off. Existing state assertions always run.
The unchanged existing artifact upload retains that directory on success and failure. No
capture is taken on a password/login screen or content feed. Capture identity must remain
the known synthetic E2E identity; blank-create and profile states must be safe BEFORE artifact
upload, not merely inspected before later sharing. Text-log password redaction
cannot remove sensitive pixels.

## Evidence still missing, not silently skipped

The current E2E seed explicitly creates no chats. No synthetic conversation ID has been
verified, so this patch does not invent a target or create/send a chat. Before adding a chat
capture, resolve an existing synthetic seed-owned conversation through authorized DEV
fixture reads, then open its real route, focus `chat-input`, verify `chat-send` and capture
actual keyboard geometry without posting anything.

The Android runner is a Pixel6/API34. It does not establish Dynamic Island/SE iOS insets or
an iOS RTL edge-back gesture. The existing flows have no orientation or locale matrix.
Landscapes, native-header versus explicit-edge branches and RTL gesture destination need a
reviewed extension on an available qualified native session. A screenshot of mirrored web
content, Android Back or a button press does not prove iOS RTL navigator gesture behavior.

Each eventual image set needs actual built SHA, device/OS, orientation, locale, state and
native view hierarchy/keyboard bounds. Evaluate content against the OS safe frame, keyboard
and navigation bars, then inspect pixels. Passing selectors alone are not visual acceptance.

## Existing artifact inventory

PR #2563 run44884931648 artifact14703697690 was downloaded on November21. It contains
120 report/log/command files for 20 flows and zero image/video files. Successful screen
recordings are discarded by the runner. iOS run51 is an unsigned logged-out landing only.
Neither supplies the four-state native visual acceptance matrix. The local environment
has no native emulator, retained APK or usable signed iOS app.

No visual acceptance is claimed for this unexecuted preparation. In-flight incident client
#2573 remains unchanged and must not be restarted to pick up this recipe. Use the next
normally qualified native run only when the serial coordinator permits it.

## Pre-upload privacy gate

Email alone is not proof of safe retained fixture fields. Existing native header/phone field
containers expose a nonvisual capture testID only when currently loaded rendered values
match a strict synthetic/empty allowlist. Profile requires E2E Member1, empty contact/bio/
street/number, no avatar and null or1990-01-01 DOB. Create requires post engine, successful
address prefill for this owner, empty text/uploads/address and no pending/resumable draft.
Only known seeded-city labels or no city are allowed. No database or form state is reset.
A missing marker SKIPS the screenshot, not a failing assertion that creates private failure
pixels. Missing expected PNGs are a capture blocker, never visual acceptance.

After each07/19 attempt (including retries), a scoped media cleanup removes automatic
failure images/videos and any non-exact capture names from that attempt's capture/debug/
report/video locations before upload. Only the three exact explicitly gated PNG names may
remain. Nonvisual diagnostics and other flows are unchanged. This is not a global artifact
privacy claim. Existing unrelated flow failure artifacts need their own existing controls.
