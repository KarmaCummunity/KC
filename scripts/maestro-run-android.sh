#!/usr/bin/env bash
# KC#1235 — installs the E2E APK on the running Android emulator and runs every Maestro flow
# in .maestro/flows/ one at a time. Each flow is screen-recorded; the video is kept only when
# the flow fails. JUnit reports and Maestro debug output (screenshots, logs) land in OUT_DIR.
#
# Usage: scripts/maestro-run-android.sh <app-release.apk> [out-dir]
# Env:   KC_E2E_PASSWORD (required), KC_E2E_EMAIL (optional; flows default to user1@seed.kc.test)
# Exit:  0 when every flow passed, 1 otherwise.

set -uo pipefail

APK="${1:?usage: maestro-run-android.sh <apk> [out-dir]}"
OUT_DIR="${2:-maestro-artifacts}"
DEVICE_VIDEO=/sdcard/kc-e2e.mp4
: "${KC_E2E_PASSWORD:?KC_E2E_PASSWORD is required (scripts/maestro-dev-env.mjs)}"

mkdir -p "$OUT_DIR/reports" "$OUT_DIR/videos" "$OUT_DIR/debug"

# A cold-booted CI emulator often shows "Pixel Launcher isn't responding" (a system ANR
# dialog) on top of every app, which hides the app's elements from Maestro. Suppress system
# crash / ANR dialogs for the run; dismiss-gates.yaml still taps "Wait" if one slips through.
adb shell settings put global hide_error_dialogs 1

adb install -r "$APK"

env_args=(-e "KC_E2E_PASSWORD=$KC_E2E_PASSWORD")
[[ -n "${KC_E2E_EMAIL:-}" ]] && env_args+=(-e "KC_E2E_EMAIL=$KC_E2E_EMAIL")

failed=()
for flow in .maestro/flows/*.yaml; do
  name="$(basename "$flow" .yaml)"
  echo "::group::$name"

  adb shell rm -f "$DEVICE_VIDEO"
  # screenrecord caps at 180 s; flows stay well under it.
  adb shell screenrecord --bit-rate 4000000 --time-limit 180 "$DEVICE_VIDEO" &
  recorder=$!

  if maestro test "$flow" "${env_args[@]}" \
      --format junit --output "$OUT_DIR/reports/$name.xml" \
      --debug-output "$OUT_DIR/debug/$name"; then
    result=passed
  else
    result=failed
    failed+=("$name")
  fi

  # SIGINT lets screenrecord finalise the mp4 before it is pulled.
  adb shell pkill -INT screenrecord || true
  wait "$recorder" 2>/dev/null || true
  if [[ "$result" == failed ]]; then
    sleep 2
    adb pull "$DEVICE_VIDEO" "$OUT_DIR/videos/$name.mp4" || echo "::warning::no video for $name"
  fi

  echo "$name: $result"
  echo "::endgroup::"
done

if ((${#failed[@]} > 0)); then
  echo "::error::Maestro flows failed: ${failed[*]}"
  exit 1
fi
echo "All Maestro flows passed."
