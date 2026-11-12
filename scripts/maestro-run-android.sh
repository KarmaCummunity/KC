#!/usr/bin/env bash
# KC#1235 — installs the E2E APK on the running Android emulator and runs every Maestro flow
# in .maestro/flows/ one at a time. Each flow is screen-recorded; the video is kept only when
# the flow fails. JUnit reports and Maestro debug output (screenshots, logs) land in OUT_DIR.
#
# Usage: scripts/maestro-run-android.sh <app-release.apk> [out-dir]
# Env:   KC_E2E_PASSWORD (required), KC_E2E_EMAIL (optional; flows default to user1@seed.kc.test)
# Exit:  0 when every flow passed (a flow may pass on its one retry, reported as a warning), 1 otherwise.

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

# Runs one flow and screen-records it. $1 flow file, $2 artifact label (the flow name, or `<name>-retry`).
# The video is kept only when the flow fails. Returns Maestro's exit status.
run_flow() {
  local flow="$1" label="$2" status=0

  adb shell rm -f "$DEVICE_VIDEO"
  # screenrecord caps at 180 s; flows stay well under it.
  adb shell screenrecord --bit-rate 4000000 --time-limit 180 "$DEVICE_VIDEO" &
  local recorder=$!

  maestro test "$flow" "${env_args[@]}" \
      --format junit --output "$OUT_DIR/reports/$label.xml" \
      --debug-output "$OUT_DIR/debug/$label" || status=$?

  # Maestro writes the -e variables, the password included, into commands.json and maestro.log.
  # The artifact is readable by everyone with repository access, so hide it before it is uploaded.
  node "$(dirname "$0")/maestro-redact.mjs" "$OUT_DIR"

  # SIGINT lets screenrecord finalise the mp4 before it is pulled.
  adb shell pkill -INT screenrecord || true
  wait "$recorder" 2>/dev/null || true
  if ((status != 0)); then
    sleep 2
    adb pull "$DEVICE_VIDEO" "$OUT_DIR/videos/$label.mp4" || echo "::warning::no video for $label"
  fi
  return "$status"
}

# A flow that fails is run once more: the journeys run against the shared kc-dev, which a deploy
# (migrations), a reseed or another run can leave unable to sign anyone in for minutes, and this job
# fails the CI gate. Before the retry the runner waits (up to ten minutes) until a seed user can sign in,
# so the retry meets a working environment instead of the same outage. A flow that passes only on the
# retry is reported as a warning (and its first attempt keeps its video and debug output), so an
# unstable flow stays visible; a flow that fails twice is a real failure.
failed=()
retried=()
for flow in .maestro/flows/*.yaml; do
  name="$(basename "$flow" .yaml)"
  echo "::group::$name"

  if run_flow "$flow" "$name"; then
    result=passed
  else
    echo "::warning::$name failed; waiting for kc-dev sign-in, then running it once more"
    # Exit 1 means no sign-in worked within the wait: the retry still runs, and its failure reads as the outage.
    node "$(dirname "$0")/maestro-wait-kc-dev.mjs" || true
    if run_flow "$flow" "$name-retry"; then
      result="passed on retry"
      retried+=("$name")
    else
      result=failed
      failed+=("$name")
    fi
  fi

  echo "$name: $result"
  echo "::endgroup::"
done

if ((${#retried[@]} > 0)); then
  echo "::warning::Maestro flows that passed only on retry: ${retried[*]}"
fi
if ((${#failed[@]} > 0)); then
  echo "::error::Maestro flows failed: ${failed[*]}"
  exit 1
fi
echo "All Maestro flows passed."
