#!/usr/bin/env node
// Picks the commit the nightly mobile pipeline (.github/workflows/mobile-nightly.yml)
// builds and decides whether it needs to build at all (D-195 tier 2, INFRA-CI-4).
//
// The candidate is the newest commit on BRANCH whose `CI` workflow push run
// concluded success. Push runs plan every lane (scripts/ci-changes.mjs), so a
// green run certifies the whole tree. That exact SHA is built, never the tip,
// so a red or still-running tip never reaches testers.
//
// iOS and Android are decided separately (each platform has its own store,
// build number and failure modes). A platform is skipped when the candidate
// already carries that platform's shipped tag — `mobile/ios/v*` or
// `mobile/android/v*`, created by the platform's own record job after its own
// store accepted the build — unless FORCE. The legacy combined tag
// `mobile/v<ver>-ios<N>-android<M>` counts as shipped for both platforms.
// So a night where only Android failed rebuilds only Android the next night.
//
// Per-platform kill switch (repo variables, tester track only):
// KC_NIGHTLY_IOS_ENABLED / KC_NIGHTLY_ANDROID_ENABLED — unset or "true" = on
// (the previous behaviour), "false" = skip that platform; any other value is
// an error (typo safety). PLATFORM ('both' default, 'ios', 'android') limits a
// manual run to one platform.
//
// Inputs (env): GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL (optional),
// BRANCH (default dev), LOOKBACK (commits to scan, 1–100, default 30), FORCE ('true'),
// PLATFORM, KC_NIGHTLY_IOS_ENABLED, KC_NIGHTLY_ANDROID_ENABLED.
// Outputs (GITHUB_OUTPUT): sha, version, build (any platform), build_ios, build_android.

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseLookback, resolveNewestGreenDevSha } from './resolve-green-dev-sha.mjs';

export { parseLookback, pickGreenSha } from './resolve-green-dev-sha.mjs';

/** Legacy combined tag (both platforms shipped in one run). */
export const SHIPPED_TAG_PREFIX = 'mobile/v';
/** Per-platform shipped tags (one per platform, written by that platform's record job). */
export const PLATFORMS = ['ios', 'android'];
export const PLATFORM_TAG_PREFIX = { ios: 'mobile/ios/v', android: 'mobile/android/v' };
export const NIGHTLY_VARS = { ios: 'KC_NIGHTLY_IOS_ENABLED', android: 'KC_NIGHTLY_ANDROID_ENABLED' };

/** Tag name for one platform's shipped build. */
export function platformTag(platform, version, buildNumber) {
  const marker = platform === 'ios' ? 'b' : 'c';
  return `${PLATFORM_TAG_PREFIX[platform]}${version}-${marker}${buildNumber}`;
}

/** Map commit SHA → shipped tag names for one platform (legacy combined tags count for both). */
export function shippedTagsFor(refs, platform) {
  const prefix = PLATFORM_TAG_PREFIX[platform];
  if (!prefix) throw new Error(`unknown platform "${platform}"`);
  const relevant = refs.filter((ref) => {
    const tag = ref.ref.replace(/^refs\/tags\//, '');
    return tag.startsWith(prefix) || tag.startsWith(SHIPPED_TAG_PREFIX);
  });
  return shippedTags(relevant);
}

/** Nightly kill switch for one platform: unset/"true" = on, "false" = off, anything else = error. */
export function nightlyEnabled(platform, env = {}) {
  const name = NIGHTLY_VARS[platform];
  const raw = String(env[name] ?? '').trim();
  if (raw === '' || raw === 'true') return { enabled: true };
  if (raw === 'false') return { enabled: false };
  return { enabled: false, error: `${name} must be "true", "false" or unset (got "${raw}")` };
}

/** Platforms a run asks for: '', 'both' (default) or one platform. */
export function requestedPlatforms(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === '' || v === 'both') return [...PLATFORMS];
  if (PLATFORMS.includes(v)) return [v];
  throw new Error(`PLATFORM must be both, ios or android (got "${raw}")`);
}

/** Per-platform decision: { ios: {build, reason}, android: {build, reason} }. */
export function planNightlyPlatforms({ greenSha, refs, force, platform, env = {} }) {
  const requested = requestedPlatforms(platform);
  const out = {};
  for (const p of PLATFORMS) {
    if (!requested.includes(p)) {
      out[p] = { build: false, reason: `not requested (platform=${platform})` };
      continue;
    }
    const gate = nightlyEnabled(p, env);
    if (gate.error) throw new Error(gate.error);
    if (!gate.enabled) {
      out[p] = { build: false, reason: `disabled by ${NIGHTLY_VARS[p]}=false` };
      continue;
    }
    out[p] = planNightly({ greenSha, shipped: shippedTagsFor(refs, p), force });
  }
  return out;
}

/** Map commit SHA → shipped tag names, from a git/matching-refs API response. */
export function shippedTags(refs) {
  const byCommit = new Map();
  for (const ref of refs) {
    // Lightweight tags point at the commit; anything else is not ours.
    if (ref.object?.type !== 'commit') continue;
    const tag = ref.ref.replace(/^refs\/tags\//, '');
    byCommit.set(ref.object.sha, [...(byCommit.get(ref.object.sha) ?? []), tag]);
  }
  return byCommit;
}

/** Decide whether tonight's candidate must be built. */
export function planNightly({ greenSha, shipped, force }) {
  if (!greenSha) throw new Error('planNightly needs a green SHA');
  const tags = shipped.get(greenSha);
  if (force) return { build: true, reason: 'forced by the `force` input' };
  if (tags) return { build: false, reason: `${greenSha} already shipped as ${tags.join(', ')}` };
  return { build: true, reason: 'new green commit' };
}

/** Validate the `MAJOR.MINOR.PATCH` content of app/VERSION. */
export function parseVersion(text) {
  const version = String(text).trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`app/VERSION is not MAJOR.MINOR.PATCH: "${version}"`);
  return version;
}

/** GET a GitHub REST path; resolves to null on 404 when `allow404` is set. */
async function api(path, { raw = false, allow404 = false } = {}) {
  const base = process.env.GITHUB_API_URL || 'https://api.github.com';
  const res = await fetch(`${base}${path}`, {
    headers: {
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (allow404 && res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}: ${await res.text()}`);
  return raw ? res.text() : res.json();
}

function writeOutputs(outputs) {
  const lines = Object.entries(outputs).map(([k, v]) => `${k}=${v}`);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}

function writeSummary(markdown) {
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

async function main() {
  const env = process.env;
  const repo = env.GITHUB_REPOSITORY;
  const branch = env.BRANCH || 'dev';
  const lookback = parseLookback(env.LOOKBACK);

  const greenSha = await resolveNewestGreenDevSha(api, { repo, branch, lookback });
  if (!greenSha) {
    console.log(`::error::No commit among the last ${lookback} on ${branch} has a successful CI push run.`);
    process.exit(1);
  }
  // An empty list (or a 404) means nothing has shipped yet. The `mobile` prefix covers
  // the legacy combined tags and both per-platform prefixes.
  const refs = (await api(`/repos/${repo}/git/matching-refs/tags/mobile`, { allow404: true })) ?? [];
  const plan = planNightlyPlatforms({
    greenSha,
    refs,
    force: env.FORCE === 'true',
    platform: env.PLATFORM,
    env,
  });
  const version = parseVersion(await api(`/repos/${repo}/contents/app/VERSION?ref=${greenSha}`, { raw: true }));
  const any = PLATFORMS.some((p) => plan[p].build);

  writeOutputs({
    sha: greenSha,
    version,
    build: String(any),
    build_ios: String(plan.ios.build),
    build_android: String(plan.android.build),
  });
  writeSummary(
    [
      `### Mobile nightly — ${any ? 'building' : 'nothing to build'}`,
      '',
      `- Green ${branch} commit: \`${greenSha}\` (version ${version})`,
      '',
      '| Platform | Build tonight | Reason |',
      '| --- | --- | --- |',
      `| iOS (TestFlight) | ${plan.ios.build ? 'yes' : 'no'} | ${plan.ios.reason} |`,
      `| Android (Play internal) | ${plan.android.build ? 'yes' : 'no'} | ${plan.android.reason} |`,
    ].join('\n'),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.log(`::error::${err.message}`);
    process.exit(1);
  });
}
