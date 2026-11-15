#!/usr/bin/env node
// Guard: `main` is the same as `dev`, except for the intended PROD
// differences listed in docs/release/PROD-DIFFERENCES.md (Nave, 15 Nov 2026:
// "main should be the same as dev, except for specific differences").
//
// Every release squashes a dev head into main (scripts/release-merge.mjs writes
// "dev head <sha>" into the commit body), so right after a release the main tree
// equals that dev commit's tree. Anything else in the main tree is drift: a
// direct push to main, a hotfix that never reached dev, or a release that was
// not cut from dev. This compares the main tree to the dev commit of the latest
// release (or to --dev <ref>) and fails on any path outside the allowlist.
//
// Usage: node scripts/check-main-dev-parity.mjs [--main <ref>] [--dev <ref>]
//   --main  the tree to check (default HEAD)
//   --dev   the dev commit to compare against (default: the "dev head" of the
//           newest release commit reachable from --main; fetched if missing)
// Read-only: runs git only.

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ALLOWLIST_PATH = 'docs/release/prod-differences.allowlist.json';
export const RELEASE_SUBJECT = 'chore(release): promote dev to main';

/** The 40-hex dev head named in a release commit message, or null. */
export function devHeadFromMessage(message) {
  const text = String(message ?? '');
  if (!text.startsWith(RELEASE_SUBJECT)) return null;
  const m = text.match(/\bdev head ([0-9a-f]{40})\b/);
  return m ? m[1] : null;
}

/** Glob (`*` within a segment, `**` across segments) to an anchored RegExp. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i += 1;
    } else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Validate the allowlist file content: [{ path, reason }], reason required. */
export function parseAllowlist(json) {
  const data = JSON.parse(json);
  const entries = Array.isArray(data?.allow) ? data.allow : null;
  if (!entries) throw new Error(`${ALLOWLIST_PATH}: expected { "allow": [ { "path", "reason" } ] }`);
  for (const e of entries) {
    if (typeof e?.path !== 'string' || !e.path.trim()) throw new Error(`${ALLOWLIST_PATH}: entry without a path`);
    if (typeof e?.reason !== 'string' || !e.reason.trim()) throw new Error(`${ALLOWLIST_PATH}: ${e.path} has no reason`);
  }
  return entries;
}

/** Split `git diff --name-status` lines into allowed and drift. */
export function classify(nameStatusLines, allowlist) {
  const patterns = allowlist.map((e) => ({ ...e, re: globToRegExp(e.path) }));
  const allowed = [];
  const drift = [];
  for (const line of nameStatusLines) {
    if (!line.trim()) continue;
    const [status, ...paths] = line.split('\t');
    const hit = patterns.find((p) => paths.some((path) => p.re.test(path)));
    (hit ? allowed : drift).push({ status, path: paths.join(' -> '), reason: hit?.reason });
  }
  return { allowed, drift };
}

function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function hasCommit(sha) {
  try {
    git(['cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function latestReleaseDevHead(mainRef) {
  // Only release subjects, newest first; then read each body on its own (the
  // first release squash carried a very long commit list).
  const shas = git(['log', '-n', '20', '--fixed-strings', `--grep=${RELEASE_SUBJECT}`, '--format=%H', mainRef])
    .split('\n')
    .filter(Boolean);
  for (const sha of shas) {
    const devHead = devHeadFromMessage(git(['log', '-1', '--format=%B', sha]));
    if (devHead) return { release: sha, devHead };
  }
  return null;
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(argv = process.argv.slice(2)) {
  const mainRef = argValue(argv, '--main') ?? 'HEAD';
  let devRef = argValue(argv, '--dev');
  let release = null;
  if (!devRef) {
    const found = latestReleaseDevHead(mainRef);
    if (!found) {
      console.log(`::error::No "${RELEASE_SUBJECT}" commit with a "dev head <sha>" line in the last 200 commits of ${mainRef}.`);
      process.exit(1);
    }
    ({ release, devHead: devRef } = found);
    if (!hasCommit(devRef)) git(['fetch', '--no-tags', '--depth=1', 'origin', devRef]);
  }
  const allowlist = parseAllowlist(readFileSync(join(ROOT, ALLOWLIST_PATH), 'utf8'));
  const lines = git(['diff', '--no-renames', '--name-status', devRef, mainRef]).split('\n');
  const { allowed, drift } = classify(lines, allowlist);
  const out = [
    `### main vs dev parity`,
    `main: \`${git(['rev-parse', mainRef]).trim()}\`; dev: \`${devRef}\`${release ? ` (dev head of release ${release.slice(0, 8)})` : ''}`,
    `Allowed differences: ${allowed.length}; drift: ${drift.length}.`,
    ...allowed.map((d) => `- allowed ${d.status} \`${d.path}\` (${d.reason})`),
    ...drift.map((d) => `- DRIFT ${d.status} \`${d.path}\``),
  ];
  console.log(out.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${out.join('\n')}\n`);
  if (drift.length) {
    console.log(`::error::main differs from dev outside ${ALLOWLIST_PATH}. Port the change to dev (or release it from dev), or list it in docs/release/PROD-DIFFERENCES.md and the allowlist with a reason.`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
