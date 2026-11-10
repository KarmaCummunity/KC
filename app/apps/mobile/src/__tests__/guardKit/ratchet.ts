// Shared plumbing for the per-file ratchet guards (spec 17 §6, D67):
// a frozen baseline of finding counts that may only go down, and the
// touched-file rule that diffs against the PR base (skipped for release traffic into `main`).
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
 * Why the touched-file rule does not apply to this run, or null when it does. The rule gates
 * feature work on its way into `dev`. A push to `main` and a dev → main release PR carry a whole
 * release whose files were already gated on their own PRs, and `dev` does not hold `main`'s
 * history until the sync PR lands, so the merge-base is the previous release and every file
 * changed since then would count. An explicit `KC_BRAND_BASE_REF` always applies the rule.
 */
export function touchedRuleSkipReason(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  if (env.KC_BRAND_BASE_REF) return null;
  if (env.GITHUB_EVENT_NAME === 'push' && env.GITHUB_REF === 'refs/heads/main') return 'push to main';
  if (env.GITHUB_BASE_REF === 'main' && env.GITHUB_HEAD_REF === 'dev') return 'dev → main release PR';
  return null;
}

/**
 * Mobile-relative files changed since the merge-base with `baseRef`, committed or not,
 * that `isScanned` accepts. Deleted files are left out. Empty when the rule is skipped
 * (`touchedRuleSkipReason`). Null when the ref cannot be resolved.
 */
export function touchedFiles(baseRef: string, isScanned: (mobilePath: string) => boolean): string[] | null {
  if (touchedRuleSkipReason()) return [];
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
