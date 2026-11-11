#!/usr/bin/env node
// Read the product spec from `origin/dev`, never from the working tree.
//
// Why this exists: a local checkout is only as fresh as its last fetch, and a
// worktree can sit on a branch cut days ago. An agent that reads docs/spec from
// disk can implement against a spec that has already moved on. This command
// fetches `dev` and prints the file as merged there (AGENTS.md §2).
//
//   node scripts/spec.mjs --list              spec files on dev
//   node scripts/spec.mjs <ref>               print one file; <ref> is a path, a name
//                                             (04_posts), a number prefix (04) or an FR-ID
//   node scripts/spec.mjs --changed           spec files that differ between HEAD and dev
//   --no-fetch                                skip the fetch (offline); says so on stderr

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SPEC_DIR = 'docs/spec/';
const REMOTE = 'origin/dev';

/**
 * Picks the spec file a reference names.
 * @param {string} ref path | file name | number prefix | FR-ID
 * @param {string[]} files spec files on dev
 * @param {(frId: string) => string[]} frFiles files that mention the FR-ID, defining file first
 * @returns {{ match?: string, candidates: string[] }}
 */
export function resolveRef(ref, files, frFiles = () => []) {
  const want = ref.trim().replace(/^\.\//, '');
  if (files.includes(want)) return { match: want, candidates: [want] };
  if (/^FR-[A-Z]+-\d+$/.test(want)) {
    const hits = frFiles(want);
    return { match: hits[0], candidates: hits.slice(0, 5) };
  }
  const stem = (file) => file.slice(file.lastIndexOf('/') + 1).replace(/\.md$/, '');
  const key = want.replace(/\.md$/, '');
  const exact = files.filter((file) => stem(file) === key || file.endsWith(`/${key}.md`));
  const loose = exact.length > 0 ? exact : files.filter((file) => stem(file).startsWith(`${key}_`) || stem(file).includes(key));
  return { match: loose.length === 1 ? loose[0] : undefined, candidates: loose };
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function specFiles() {
  return git('ls-tree', '-r', '--name-only', REMOTE, SPEC_DIR).split('\n').filter((file) => file.endsWith('.md'));
}

/**
 * Rank files that mention an FR-ID. A file whose heading defines it
 * (`## FR-XXX-NNN`) comes first. Mention counts break ties only among
 * non-defining files.
 * @param {{ file: string, count: number, defines?: boolean }[]} hits
 * @returns {string[]}
 */
export function rankFrHits(hits) {
  return hits
    .slice()
    .sort((a, b) => {
      const aDef = Boolean(a.defines);
      const bDef = Boolean(b.defines);
      if (aDef !== bDef) return aDef ? -1 : 1;
      if (aDef) return a.file.localeCompare(b.file);
      return b.count - a.count || a.file.localeCompare(b.file);
    })
    .map((hit) => hit.file);
}

/** True when `content` has a heading that defines `frId` (`## FR-XXX-NNN`). */
export function fileDefinesFr(content, frId) {
  const pattern = new RegExp(`^## ${frId}(?:\\s|$)`, 'm');
  return pattern.test(content);
}

function definingFiles(frId) {
  let out = '';
  try {
    out = git('grep', '-l', '-E', `^## ${frId}($|[[:space:]])`, REMOTE, '--', `${SPEC_DIR}requirements`);
  } catch {
    return new Set();
  }
  return new Set(
    out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const cut = line.indexOf(':');
        return cut === -1 ? line : line.slice(cut + 1);
      }),
  );
}

/** Files mentioning an FR-ID, the defining heading first, then by mention count. */
function filesMentioning(frId) {
  let out = '';
  try {
    out = git('grep', '-c', '-w', frId, REMOTE, '--', `${SPEC_DIR}requirements`);
  } catch {
    return [];
  }
  const defines = definingFiles(frId);
  const hits = out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [, file, count] = /^[^:]+:(.+):(\d+)$/.exec(line) ?? [];
      return { file, count: Number(count), defines: defines.has(file) };
    })
    .filter((hit) => hit.file);
  return rankFrHits(hits);
}

function refresh() {
  try {
    execFileSync('git', ['fetch', '--quiet', 'origin', 'dev'], { stdio: 'ignore' });
  } catch {
    process.stderr.write(`spec: could not fetch; showing the last known ${REMOTE} (it may be stale)\n`);
  }
}

function main(argv) {
  const noFetch = argv.includes('--no-fetch');
  const args = argv.filter((arg) => arg !== '--no-fetch');
  if (args.length === 0) {
    process.stderr.write('usage: node scripts/spec.mjs --list | --changed | <path|name|number|FR-ID> [--no-fetch]\n');
    return 2;
  }
  if (!noFetch) refresh();

  if (args[0] === '--list') {
    process.stdout.write(`${specFiles().join('\n')}\n`);
    return 0;
  }
  if (args[0] === '--changed') {
    const changed = git('diff', '--name-only', `HEAD...${REMOTE}`, '--', SPEC_DIR).split('\n').filter(Boolean);
    if (changed.length === 0) process.stdout.write(`No spec file changed on dev since this branch was cut.\n`);
    else process.stdout.write(`Changed on dev since this branch was cut (read them from dev, not from disk):\n${changed.join('\n')}\n`);
    return 0;
  }

  const { match, candidates } = resolveRef(args[0], specFiles(), filesMentioning);
  if (!match) {
    process.stderr.write(candidates.length > 0 ? `spec: "${args[0]}" is ambiguous:\n${candidates.join('\n')}\n` : `spec: nothing matches "${args[0]}" (try --list)\n`);
    return 1;
  }
  process.stderr.write(`# ${match} @ ${git('rev-parse', '--short', REMOTE).trim()} (${REMOTE})\n`);
  process.stdout.write(git('show', `${REMOTE}:${match}`));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main(process.argv.slice(2));
