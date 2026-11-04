#!/usr/bin/env node
// Guard: no unresolved merge-conflict markers in tracked files.
//
// A conflict resolved in one file but committed with markers left in another
// passes every other check: the SSOT link guard, spec-ID check and Markdown
// readers ignore them, and squash merges carry them into `dev` (it happened on
// 2026-11-03 in docs/SSOT/TECH_DEBT.md). Git writes a conflict as three lines:
// `<<<<<<< <ref>`, `=======` and `>>>>>>> <ref>`; this guard fails when it finds
// an opening marker followed by a separator and a closing marker, in that order,
// so a lone `=======` (a Markdown setext underline) never trips it.
//
// Usage: node scripts/check-conflict-markers.mjs   (exit 1 when markers are found)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const OPEN = /^<{7}(?: |$)/;
const SEPARATOR = /^={7}$/;
const CLOSE = /^>{7}(?: |$)/;
/** Files git treats as binary (a NUL byte in the first 8 KB) are skipped. */
const BINARY_PROBE_BYTES = 8000;

/**
 * Line numbers (1-based) of each opening marker that starts a complete
 * `<<<<<<<` … `=======` … `>>>>>>>` block.
 * @param {string} text
 * @returns {number[]}
 */
export function findConflictBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let open = -1;
  let separated = false;
  lines.forEach((line, index) => {
    if (OPEN.test(line)) {
      open = index;
      separated = false;
    } else if (open >= 0 && SEPARATOR.test(line)) {
      separated = true;
    } else if (open >= 0 && separated && CLOSE.test(line)) {
      blocks.push(open + 1);
      open = -1;
      separated = false;
    }
  });
  return blocks;
}

/**
 * Every `path:line` with a conflict block among the given files.
 * @param {string[]} paths repository-relative paths
 * @param {(path: string) => Buffer} readFile
 * @returns {string[]}
 */
export function scanFiles(paths, readFile) {
  const hits = [];
  for (const path of paths) {
    let content;
    try {
      content = readFile(path);
    } catch {
      continue; // listed by git but gone from the working tree (deleted, unstaged)
    }
    if (content.subarray(0, BINARY_PROBE_BYTES).includes(0)) continue;
    for (const line of findConflictBlocks(content.toString('utf8'))) hits.push(`${path}:${line}`);
  }
  return hits;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const paths = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\0')
    .filter(Boolean);
  const hits = scanFiles(paths, (path) => readFileSync(join(REPO_ROOT, path)));
  if (hits.length > 0) {
    console.error('Unresolved merge-conflict markers (resolve the conflict, then commit):');
    for (const hit of hits) console.error(`  ${hit}`);
    process.exit(1);
  }
  console.log(`✓ Conflict-marker guard passed — ${paths.length} tracked files scanned.`);
}
