// Shared plumbing for the per-file ratchet guards (spec 17 §6, D67):
// a frozen baseline of finding counts that may only go down, and the
// touched-file rule that diffs against the PR base.
// Used by brandGuard.test.ts (style literals) and copyVoiceGuard.test.ts (copy voice, D93).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MOBILE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const REPO_ROOT = path.resolve(MOBILE_ROOT, '../../..');
const MOBILE_FROM_REPO = `${path.relative(REPO_ROOT, MOBILE_ROOT).split(path.sep).join('/')}/`;

export type FileCounts<R extends string> = Partial<Record<R, number>>;
export type Baseline<R extends string> = Record<string, FileCounts<R>>;

export function readBaseline<R extends string>(baselinePath: string): Baseline<R> {
  return (JSON.parse(readFileSync(baselinePath, 'utf8')) as { files: Baseline<R> }).files;
}

export function writeBaseline<R extends string>(baselinePath: string, comment: string, files: Baseline<R>): void {
  writeFileSync(baselinePath, `${JSON.stringify({ $comment: comment, files }, null, 2)}\n`);
}

/** Per file and rule: counts above the baseline (`grew`) and below it (`shrank`). */
export function compareToBaseline<R extends string>(
  rules: readonly R[],
  current: Baseline<R>,
  baseline: Baseline<R>,
): { grew: string[]; shrank: string[] } {
  const grew: string[] = [];
  const shrank: string[] = [];
  const files = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  for (const file of files) {
    for (const rule of rules) {
      const now = current[file]?.[rule] ?? 0;
      const allowed = baseline[file]?.[rule] ?? 0;
      if (now > allowed) grew.push(`${file}: ${rule} ${now} > ${allowed}`);
      if (now < allowed) shrank.push(`${file}: ${rule} ${now} < ${allowed}`);
    }
  }
  return { grew, shrank };
}

/** Base the touched-file rule diffs against: the PR base in CI, else `origin/dev`. */
export function touchedBaseRef(): string {
  const prBase = process.env.GITHUB_BASE_REF;
  return process.env.KC_BRAND_BASE_REF ?? (prBase ? `origin/${prBase}` : 'origin/dev');
}

function git(args: readonly string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

/**
 * Mobile-relative files changed since the merge-base with `baseRef`, committed or not,
 * that `isScanned` accepts. Deleted files are left out. Null when the ref cannot be resolved.
 */
export function touchedFiles(baseRef: string, isScanned: (mobilePath: string) => boolean): string[] | null {
  let mergeBase: string;
  try {
    mergeBase = git(['merge-base', baseRef, 'HEAD']);
  } catch {
    return null;
  }
  return git(['diff', '--name-only', '--diff-filter=ACMR', mergeBase, '--', MOBILE_FROM_REPO])
    .split('\n')
    .filter((file) => file.startsWith(MOBILE_FROM_REPO))
    .map((file) => file.slice(MOBILE_FROM_REPO.length))
    .filter(isScanned);
}
