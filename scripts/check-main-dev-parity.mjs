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
//   --dev   the dev commit to compare against (default: the dev head of the
//           newest release commit reachable from --main; fetched if missing)
//
// The dev head of a release is the "dev head <sha>" line release-merge.mjs
// writes. A release squashed by hand (e.g. v1.9.176, #2404, merged in the UI)
// has no such line; then the dev head is the newest dev commit whose tree is
// the release commit's tree. Only the NEWEST release is used: comparing with
// an older release's dev head reports every later change as drift (run
// 44053181695: 449 false paths on identical trees).
//
// A path that differs from the release's dev head but whose main content is
// byte-identical to dev at some commit after that head (a hotfix cherry-picked
// to main after it landed on dev, e.g. #2499 from #2498) is reported as
// "already on dev", not drift: it reached dev, and the next release carries
// dev's newer version. Content that never existed on dev is still drift.
// Read-only: runs git only (fetches origin/dev if it is missing).

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

/** The newest dev commit (`<sha> <tree>` lines, newest first) whose tree is `tree`, or null. */
export function devHeadByTree(tree, devLogLines) {
  for (const line of devLogLines) {
    const [sha, t] = line.trim().split(/\s+/);
    if (sha && t === tree) return sha;
  }
  return null;
}

/** Split drift into paths whose main content reached dev and real drift. */
export function splitAlreadyOnDev(drift, reachedDev) {
  const onDev = [];
  const rest = [];
  for (const d of drift) (reachedDev(d.path) ? onDev : rest).push(d);
  return { onDev, drift: rest };
}

const DEV_TIP = 'refs/remotes/origin/dev';

function ensureDevTip() {
  try {
    git(['rev-parse', '--verify', '--quiet', `${DEV_TIP}^{commit}`]);
  } catch {
    git(['fetch', '--no-tags', 'origin', `+refs/heads/dev:${DEV_TIP}`]);
  }
}

/** Object id of `path` at `ref`, or null when the path does not exist there. */
function objectAt(ref, path) {
  try {
    return git(['rev-parse', '--verify', '--quiet', `${ref}:${path}`]).trim() || null;
  } catch {
    return null;
  }
}

/** True when `path` at `mainRef` equals dev's version at the tip or at any dev commit after `devRef`. */
function reachedDevSince(devRef, mainRef, path) {
  const want = objectAt(mainRef, path);
  if (want === objectAt(DEV_TIP, path)) return true;
  if (!want) return false;
  const commits = git(['log', '--format=%H', `${devRef}..${DEV_TIP}`, '--', path]).split('\n').filter(Boolean);
  return commits.some((c) => objectAt(c, path) === want);
}

function latestReleaseDevHead(mainRef) {
  // The newest release subject only; its body is read on its own (the first
  // release squash carried a very long commit list).
  const [release] = git(['log', '-n', '1', '--fixed-strings', `--grep=${RELEASE_SUBJECT}`, '--format=%H', mainRef])
    .split('\n')
    .filter(Boolean);
  if (!release) return null;
  const fromMessage = devHeadFromMessage(git(['log', '-1', '--format=%B', release]));
  if (fromMessage) return { release, devHead: fromMessage, how: 'dev head line' };
  ensureDevTip();
  const tree = git(['rev-parse', `${release}^{tree}`]).trim();
  const devLog = git(['log', '-n', '5000', '--format=%H %T', DEV_TIP]).split('\n');
  const byTree = devHeadByTree(tree, devLog);
  return byTree ? { release, devHead: byTree, how: 'same tree on dev' } : { release, devHead: null };
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(argv = process.argv.slice(2)) {
  const mainRef = argValue(argv, '--main') ?? 'HEAD';
  let devRef = argValue(argv, '--dev');
  let release = null;
  let how = null;
  if (!devRef) {
    const found = latestReleaseDevHead(mainRef);
    if (!found) {
      console.log(`::error::No "${RELEASE_SUBJECT}" commit in the history of ${mainRef}.`);
      process.exit(1);
    }
    if (!found.devHead) {
      console.log(`::error::Release ${found.release} has no "dev head <sha>" line and no dev commit has its tree; pass --dev <sha>.`);
      process.exit(1);
    }
    ({ release, devHead: devRef, how } = found);
    if (!hasCommit(devRef)) git(['fetch', '--no-tags', '--depth=1', 'origin', devRef]);
  }
  const allowlist = parseAllowlist(readFileSync(join(ROOT, ALLOWLIST_PATH), 'utf8'));
  const lines = git(['diff', '--no-renames', '--name-status', devRef, mainRef]).split('\n');
  const classified = classify(lines, allowlist);
  const { allowed } = classified;
  let onDev = [];
  let drift = classified.drift;
  if (drift.length) {
    ensureDevTip();
    ({ onDev, drift } = splitAlreadyOnDev(drift, (path) => reachedDevSince(devRef, mainRef, path)));
  }
  const out = [
    `### main vs dev parity`,
    `main: \`${git(['rev-parse', mainRef]).trim()}\`; dev: \`${devRef}\`${release ? ` (dev head of release ${release.slice(0, 8)}, ${how})` : ''}`,
    `Allowed differences: ${allowed.length}; already on dev: ${onDev.length}; drift: ${drift.length}.`,
    ...allowed.map((d) => `- allowed ${d.status} \`${d.path}\` (${d.reason})`),
    ...onDev.map((d) => `- already on dev ${d.status} \`${d.path}\` (main's content reached dev after the release; the next release carries dev's version)`),
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
