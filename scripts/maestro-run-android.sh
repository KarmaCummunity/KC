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

mkdir -p "$OUT_DIR/reports" "$OUT_DIR/videos" "$OUT_DIR/debug" "$OUT_DIR/captures"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"

# A cold-booted CI emulator often shows "Pixel Launcher isn't responding" (a system ANR
# dialog) on top of every app, which hides the app's elements from Maestro. Suppress system
# crash / ANR dialogs for the run; dismiss-gates.yaml still taps "Wait" if one slips through.
adb shell settings put global hide_error_dialogs 1

adb install -r "$APK"

env_args=(-e "KC_E2E_PASSWORD=$KC_E2E_PASSWORD")
[[ -n "${KC_E2E_EMAIL:-}" ]] && env_args+=(-e "KC_E2E_EMAIL=$KC_E2E_EMAIL")
# Explicit success images only for the known synthetic default identity, never an override.
capture_safe=false
[[ "${KC_E2E_EMAIL:-user1@seed.kc.test}" == 'user1@seed.kc.test' ]] && capture_safe=true
env_args+=(-e "KC_NATIVE_CAPTURE_SAFE=$capture_safe")

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
      --test-output-dir "$OUT_DIR/captures/$label" \
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
  node "$(dirname "$0")/maestro-native-capture-media.mjs" "$OUT_DIR" "$label"
  return "$status"
}

# A flow that fails is run once more: the journeys run against the shared kc-dev, which a deploy
# (migrations), a reseed or another run can leave unable to sign anyone in for minutes, and this job
# fails the CI gate. Before the retry the runner waits (up to ten minutes) until a seed user can sign in,
# so the retry meets a working environment instead of the same outage. A flow that passes only on the
# retry is reported as a warning (and its first attempt keeps its video and debug output), so an
# unstable flow stays visible; a flow that fails twice is a real failure.
#
# Fail fast instead of grinding: a failed flow costs up to ~15 min (2 attempts + the sign-in wait), so
# on a stalled kc-dev the 19 flows would run for hours and end as a step timeout or a manual cancel
# (15 Nov 2026: 9 jobs, all cancelled after 24–47 min). The run stops, failed, with the reason, when
#  - kc-dev never signs anyone in during the wait (an outage: the retry would only repeat it), or
#  - KC_MAESTRO_MAX_CONSECUTIVE_FAILS (default 3) flows in a row fail twice.
# The flows not run are listed. The gate still fails; nothing is skipped silently.
max_consecutive="${KC_MAESTRO_MAX_CONSECUTIVE_FAILS:-3}"
flows=(.maestro/flows/*.yaml)
failed=()
retried=()
consecutive=0
stop_reason=""
for i in "${!flows[@]}"; do
  flow="${flows[$i]}"
  name="$(basename "$flow" .yaml)"
  echo "::group::$name"

  if run_flow "$flow" "$name"; then
    result=passed
  else
    echo "::warning::$name failed; waiting for kc-dev sign-in, then running it once more"
    if ! node "$(dirname "$0")/maestro-wait-kc-dev.mjs"; then
      result="failed (kc-dev unavailable)"
      failed+=("$name")
      stop_reason="kc-dev did not sign in the seed user during the wait (outage on kc-dev, not this PR's journeys)"
    elif run_flow "$flow" "$name-retry"; then
      result="passed on retry"
      retried+=("$name")
    else
      result=failed
      failed+=("$name")
    fi
  fi

  if [[ "$result" == failed* ]]; then consecutive=$((consecutive + 1)); else consecutive=0; fi
  if [[ -z "$stop_reason" ]] && ((consecutive >= max_consecutive)); then
    stop_reason="$consecutive flows in a row failed twice (kc-dev degraded or a broken build)"
  fi

  echo "$name: $result"
  echo "::endgroup::"

  if [[ -n "$stop_reason" ]]; then
    not_run=()
    for rest in "${flows[@]:$((i + 1))}"; do not_run+=("$(basename "$rest" .yaml)"); done
    echo "::error::Maestro stopped early: $stop_reason. Not run (${#not_run[@]}): ${not_run[*]:-none}"
    break
  fi
done

if ((${#retried[@]} > 0)); then
  echo "::warning::Maestro flows that passed only on retry: ${retried[*]}"
fi
if ((${#failed[@]} > 0)); then
  echo "::error::Maestro flows failed: ${failed[*]}"
  exit 1
fi
echo "All Maestro flows passed."
