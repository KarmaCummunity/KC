#!/usr/bin/env bash
# Upload source maps to Sentry after each EAS build.
# Non-fatal: missing SENTRY_AUTH_TOKEN logs and exits 0 rather than failing the build.
set -euo pipefail

if [[ -z "${SENTRY_AUTH_TOKEN:-}" ]]; then
  echo "[sentry] no token — skip"
  exit 0
fi

ORG="${SENTRY_ORG:-karma-community}"
export SENTRY_URL="${SENTRY_URL:-https://de.sentry.io/}"
PROJECT="${SENTRY_PROJECT:-kc-mobile}"

npx --yes @sentry/cli releases --org "$ORG" --project "$PROJECT" \
  files "$EXPO_VERSION" upload-sourcemaps dist || { echo "[sentry] upload failed — non-fatal"; exit 0; }
