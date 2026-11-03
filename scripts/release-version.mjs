#!/usr/bin/env node
// Release version bookkeeping for the gated prod pipeline (D-195, INFRA-CI-3).
//
// Every production release is tagged `vX.Y.Z` from app/VERSION on the deployed
// commit. A tag that already exists on a different commit means the release
// forgot to bump app/VERSION, so tagging fails closed; the CI release lane
// checks the same thing before merge (`check-bump`).
//
// Commands (run from the repo root with tags fetched):
//   check-bump        fail unless app/VERSION is greater than the latest v* tag
//   latest            print `tag` / `sha` of the latest v* tag (empty if none)
//   tag-plan <sha>    print `tag`, `action` (create | exists) and the release
//                     before it (`previous`, `previous_sha`; empty if none)
// Outputs go to stdout and, when set, $GITHUB_OUTPUT.

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** [major, minor, patch] for "X.Y.Z" or "vX.Y.Z", else null. */
export function parseSemver(text) {
  const m = SEMVER.exec(String(text).replace(/^v/, ''));
  return m ? m.slice(1).map(Number) : null;
}

/** Negative, zero or positive, like a sort comparator. Both must parse. */
export function compareSemver(a, b) {
  const [pa, pb] = [parseSemver(a), parseSemver(b)];
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** Highest `vX.Y.Z` tag name; tags of any other shape are ignored. */
export function latestReleaseTag(tags) {
  const releases = tags.filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
  return releases.sort(compareSemver).at(-1) ?? null;
}

/** Reasons app/VERSION cannot be released on top of `tags` (empty = ok). */
export function checkVersionBump(version, tags) {
  if (!parseSemver(version)) return [`app/VERSION must be MAJOR.MINOR.PATCH, got "${version}"`];
  const latest = latestReleaseTag(tags);
  if (latest && compareSemver(version, latest) <= 0) {
    return [`app/VERSION ${version} is not greater than the latest release tag ${latest}; bump it on dev before releasing.`];
  }
  return [];
}

/**
 * Decide what to do with tag v<version> for `sha`. `existingSha` is the commit
 * the tag already points at (null if absent). Re-running a deploy of the same
 * commit is fine; the same tag on another commit is the forgotten-bump signal.
 */
export function planTag({ version, sha, existingSha }) {
  const tag = `v${version}`;
  if (!existingSha) return { tag, action: 'create' };
  if (existingSha === sha) return { tag, action: 'exists' };
  throw new Error(`Tag ${tag} already points at ${existingSha}, not ${sha}: app/VERSION was not bumped for this release.`);
}

function git(...args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function releaseTags() {
  return git('tag', '--list', 'v*').split('\n').filter(Boolean);
}

/** Commit a tag points at (peeling annotated tags), or null. */
function tagCommit(tag) {
  try {
    return git('rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`);
  } catch {
    return null;
  }
}

function emit(values) {
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v ?? ''}`);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}

function main([command, sha]) {
  const version = readFileSync(join(REPO_ROOT, 'app/VERSION'), 'utf8').trim();
  const tags = releaseTags();
  const latest = latestReleaseTag(tags);
  if (command === 'check-bump') {
    const errors = checkVersionBump(version, tags);
    for (const e of errors) console.log(`::error::${e}`);
    if (errors.length) process.exit(1);
    console.log(`app/VERSION ${version} > ${latest ?? '(no release tag yet)'}`);
  } else if (command === 'latest') {
    emit({ tag: latest, sha: latest ? tagCommit(latest) : '' });
  } else if (command === 'tag-plan' && /^[0-9a-f]{40}$/.test(sha ?? '')) {
    const plan = planTag({ version, sha, existingSha: tagCommit(`v${version}`) });
    const previous = latestReleaseTag(tags.filter((t) => t !== plan.tag));
    emit({ ...plan, previous, previous_sha: previous ? tagCommit(previous) : '' });
  } else {
    console.error('usage: release-version.mjs check-bump | latest | tag-plan <40-hex sha>');
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.log(`::error::${err.message}`);
    process.exit(1);
  }
}
