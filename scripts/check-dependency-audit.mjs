#!/usr/bin/env node
// Dependency audit (#1373): the single authoritative check for known
// advisories in every npm dependency the repository installs or imports —
// each committed pnpm/npm lockfile (app, scripts, e2e tests) plus the pinned
// npm imports of the Edge Functions.
//
// A high or critical advisory fails unless a reviewed, unexpired exception in
// check-dependency-audit.allowlist.json covers it (rules in
// check-dependency-audit-policy.mjs). Moderate and low advisories are listed
// but never fail.
//
// A new advisory can appear without any change to the repository, so the PR
// gate passes `--changed-since <base>` and audits only when a dependency file
// changed (TD-254); the scheduled `Dependency audit` workflow audits `dev` and
// `main` daily and opens an issue when it fails. The allowlist is validated on
// every run, because that check never reads the clock.
//
// Usage: node scripts/check-dependency-audit.mjs [--changed-since <sha>] [--allowlist <path>]
// Exit codes: 0 passed or skipped; 1 blocking findings or an invalid
// allowlist; 2 the audit could not run (registry unreachable, unreadable
// lockfile). The gate fails on any non-zero code, so an audit that cannot run
// never passes.

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluate, validateAllowlist } from './check-dependency-audit-policy.mjs';
import { fetchAdvisories, matchFindings } from './check-dependency-audit-registry.mjs';
import { renderLog, renderSummary } from './check-dependency-audit-report.mjs';
import { collectInventory, parserFor } from './check-dependency-audit-sources.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ALLOWLIST = 'scripts/check-dependency-audit.allowlist.json';
const NULL_SHA = /^0+$/;

export const EXIT = Object.freeze({ PASSED: 0, FAILED: 1, ERROR: 2 });

/**
 * Parses the command line.
 * @param {string[]} argv arguments after the script path
 * @returns {{ changedSince: string | null, allowlist: string }}
 */
export function parseArgs(argv) {
  const options = { changedSince: null, allowlist: DEFAULT_ALLOWLIST };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if ((flag === '--changed-since' || flag === '--allowlist') && value && !value.startsWith('--')) {
      options[flag === '--changed-since' ? 'changedSince' : 'allowlist'] = value;
      i += 1;
    } else {
      throw new TypeError(`unknown or incomplete argument "${flag}"`);
    }
  }
  return options;
}

/**
 * Whether a changed path can change the audit's result: any file the
 * inventory reads, any package.json (its overrides or ranges move the
 * lockfile) and the audit itself (scripts, allowlist, dependency pins).
 * @param {string} path repository-relative path
 */
export function isDependencyPath(path) {
  if (parserFor(path) !== null) return true;
  if (path === 'package.json' || path.endsWith('/package.json')) return true;
  return path.startsWith('scripts/check-dependency-audit');
}

/**
 * Decides whether the diff since `base` needs an audit. A missing, null or
 * unknown base (new branch, shallow history) means "audit": skipping must be
 * proven, never assumed.
 * @param {string | null} base
 * @param {(base: string) => string[]} listChanged paths changed since base
 * @returns {{ audit: boolean, reason: string }}
 */
export function auditNeeded(base, listChanged) {
  if (!base || NULL_SHA.test(base)) return { audit: true, reason: 'no base commit' };
  let changed;
  try {
    changed = listChanged(base);
  } catch {
    return { audit: true, reason: `base ${base} is not available` };
  }
  const relevant = changed.filter(isDependencyPath);
  return relevant.length > 0
    ? { audit: true, reason: `dependency files changed: ${relevant.join(', ')}` }
    : { audit: false, reason: `no dependency file changed since ${base}` };
}

/** `git` in the repository root, returning trimmed stdout lines. */
function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Runs the audit and returns its exit code. Every side effect is injectable.
 * @param {{
 *   argv?: string[], today?: string, env?: Record<string, string | undefined>,
 *   log?: (line: string) => void, gitLines?: (args: string[]) => string[],
 *   readFile?: (path: string) => string, fetchImpl?: typeof fetch,
 * }} [io]
 */
export async function runAudit(io = {}) {
  const env = io.env ?? process.env;
  const log = io.log ?? ((line) => console.log(line));
  const gitLines = io.gitLines ?? git;
  const readFile = io.readFile ?? ((path) => readFileSync(join(REPO_ROOT, path), 'utf8'));
  const today = io.today ?? new Date().toISOString().slice(0, 10);
  const options = parseArgs(io.argv ?? []);

  const { exceptions, errors } = validateAllowlist(JSON.parse(readFile(options.allowlist)));
  for (const message of errors) log(`ERROR ${options.allowlist}: ${message}`);
  if (errors.length > 0) return EXIT.FAILED;

  if (options.changedSince !== null) {
    const decision = auditNeeded(options.changedSince, (base) => gitLines(['diff', '--name-only', base, 'HEAD']));
    log(`Dependency audit ${decision.audit ? 'runs' : 'skipped'}: ${decision.reason}.`);
    if (!decision.audit) return EXIT.PASSED;
  }

  const inventory = collectInventory(gitLines(['ls-files']), readFile);
  const advisories = await fetchAdvisories(inventory.packages, { fetchImpl: io.fetchImpl });
  const verdict = evaluate(matchFindings(inventory.packages, advisories), exceptions, today);
  const annotate = env.GITHUB_ACTIONS === 'true';
  for (const line of renderLog(verdict, { ...inventory, annotate })) log(line);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${renderSummary(verdict)}\n`);
  return verdict.blocking.length > 0 ? EXIT.FAILED : EXIT.PASSED;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAudit({ argv: process.argv.slice(2) })
    .then((code) => process.exit(code))
    .catch((error) => {
      // Registry outages and unreadable lockfiles: the audit did not run, so
      // it must not pass. Only the message is printed, never a stack.
      console.error(`ERROR dependency audit could not run: ${error?.message ?? error}`);
      process.exit(EXIT.ERROR);
    });
}
