#!/usr/bin/env node
// Picks the commit the nightly mobile pipeline (.github/workflows/mobile-nightly.yml)
// builds and decides whether it needs to build at all (D-195 tier 2, INFRA-CI-4).
//
// The candidate is the newest commit on BRANCH whose `CI` workflow push run
// concluded success. Push runs plan every lane (scripts/ci-changes.mjs), so a
// green run certifies the whole tree. That exact SHA is built, never the tip,
// so a red or still-running tip never reaches testers. The build is skipped
// when the candidate already carries a `mobile/v*` tag: the pipeline creates
// that tag only after both store submissions succeeded — unless FORCE.
//
// Inputs (env): GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL (optional),
// BRANCH (default dev), LOOKBACK (commits to scan, 1–100, default 30), FORCE ('true').
// Outputs (GITHUB_OUTPUT): sha, version, build ('true' | 'false').

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseLookback, resolveNewestGreenDevSha } from './resolve-green-dev-sha.mjs';

export { parseLookback, pickGreenSha } from './resolve-green-dev-sha.mjs';

/** Prefix of the per-build traceability tags; a tagged commit has shipped. */
export const SHIPPED_TAG_PREFIX = 'mobile/v';

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
  // An empty list (or a 404) means nothing has shipped yet.
  const refs = (await api(`/repos/${repo}/git/matching-refs/tags/${SHIPPED_TAG_PREFIX}`, { allow404: true })) ?? [];
  const plan = planNightly({ greenSha, shipped: shippedTags(refs), force: env.FORCE === 'true' });
  const version = parseVersion(await api(`/repos/${repo}/contents/app/VERSION?ref=${greenSha}`, { raw: true }));

  writeOutputs({ sha: greenSha, version, build: String(plan.build) });
  writeSummary(
    [
      `### Mobile nightly — ${plan.build ? 'building' : 'nothing to build'}`,
      '',
      `- Green ${branch} commit: \`${greenSha}\` (version ${version})`,
      `- Decision: ${plan.reason}`,
    ].join('\n'),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.log(`::error::${err.message}`);
    process.exit(1);
  });
}
