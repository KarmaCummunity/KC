// `/version.json` for the KC web export.
//
// The deploy smoke (scripts/smoke-deploy.mjs) and the release lane of CI poll
// this file to prove which commit a host is serving, so the SHA must be the
// commit that was built, never a guess. The deploy pipeline passes it
// explicitly in EXPO_PUBLIC_GIT_COMMIT_SHA (in a `workflow_run` deploy,
// GITHUB_SHA is the default branch tip, not the deployed commit); other CI
// builds fall back to GITHUB_SHA. No git process is spawned: a build must not
// depend on whatever `git` the PATH resolves to (Sonar S4036), and a local
// build without either variable is stamped 'unknown', which no deploy accepts.

import { readFileSync } from 'node:fs';

const FULL_SHA = /^[0-9a-f]{40}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

/** Read and validate `app/VERSION` (MAJOR.MINOR.PATCH). */
export function readAppVersion(versionPath) {
  const version = readFileSync(versionPath, 'utf8').trim();
  if (!SEMVER.test(version)) {
    throw new Error(`${versionPath} must hold MAJOR.MINOR.PATCH, got "${version}"`);
  }
  return version;
}

/**
 * The full commit SHA to stamp. An explicit EXPO_PUBLIC_GIT_COMMIT_SHA wins and
 * must be a full 40-hex SHA (a short or malformed value would never match the
 * smoke's expected SHA, so fail the build instead). Without it, use
 * GITHUB_SHA when it is a full SHA; 'unknown' otherwise.
 */
export function resolveBuildSha(env) {
  const explicit = env.EXPO_PUBLIC_GIT_COMMIT_SHA?.trim();
  if (explicit) {
    if (!FULL_SHA.test(explicit)) {
      throw new Error(`EXPO_PUBLIC_GIT_COMMIT_SHA must be a full 40-character SHA, got "${explicit}"`);
    }
    return explicit;
  }
  const ci = env.GITHUB_SHA?.trim();
  return ci && FULL_SHA.test(ci) ? ci : 'unknown';
}

/** Body of `/version.json`. */
export function renderVersionFile({ version, sha, builtAt }) {
  return `${JSON.stringify({ version, sha, builtAt }, null, 2)}\n`;
}
