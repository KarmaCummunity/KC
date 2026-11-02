#!/usr/bin/env node
// Fails when a workflow runs a repository script that no code owner owns.
//
// A script a workflow runs decides a lane's result or acts with that job's
// credentials (the post-merge bump job pushes to `dev` as a ruleset bypass
// actor). If an agent can edit it without owner review, the gate, or the
// credential, is as good as handed over. This guard collects every
// `scripts/…` / `app/scripts/…` path referenced from `.github/workflows/` and
// `.github/actions/`, follows their relative imports, and requires each one to
// be owned in `.github/CODEOWNERS`. Script self-tests (`*.test.*`) stay unowned
// by design, so agents may add tests freely (`D-195`).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// A script path inside a workflow, not followed by more path characters (so
// `scripts/package-lock.json` never yields `scripts/package-lock.js`).
const SCRIPT_REF = /(?<![\w./-])((?:app\/)?scripts\/[\w./-]+\.(?:mjs|cjs|js|sh))(?![\w.-])/g;
// Static and dynamic relative imports of a JavaScript module.
const RELATIVE_IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g;
const TEST_FILE = /\.test\.[cm]?js$/;

/**
 * Converts one CODEOWNERS pattern to a RegExp over repository-relative paths,
 * following the gitignore-style rules GitHub documents: a leading or inner `/`
 * anchors the pattern at the root, a trailing `/` matches a directory's
 * contents, `*` stays within one path segment and `**` crosses segments.
 * @param {string} pattern
 * @returns {RegExp}
 */
export function patternToRegExp(pattern) {
  const directory = pattern.endsWith('/');
  const body = pattern.replace(/^\//, '').replace(/\/$/, '');
  const anchored = pattern.startsWith('/') || body.includes('/');
  const source = body
    .split('**')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*'))
    .join('.*');
  const prefix = anchored ? '^' : '(?:^|/)';
  // A directory pattern matches only what lies below it; any other pattern
  // matches the named file or directory and everything inside it.
  return new RegExp(`${prefix}${source}${directory ? '/' : '(?:/|$)'}`);
}

/**
 * Parses CODEOWNERS into ordered rules; blank lines and comments are dropped.
 * @param {string} text
 * @returns {{ pattern: string, owners: string[], regex: RegExp }[]}
 */
export function parseCodeowners(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const [pattern, ...owners] = line.split(/\s+/);
      return { pattern, owners, regex: patternToRegExp(pattern) };
    });
}

/**
 * Whether the last matching rule for `path` names at least one owner.
 * @param {string} path repository-relative, forward slashes
 * @param {ReturnType<typeof parseCodeowners>} rules
 */
export function isOwned(path, rules) {
  let owned = false;
  for (const rule of rules) {
    if (rule.regex.test(path)) owned = rule.owners.length > 0;
  }
  return owned;
}

// Workflow and composite-action YAML files under .github/.
function workflowFiles(repoRoot) {
  const files = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.ya?ml$/.test(name)) files.push(full);
    }
  };
  walk(join(repoRoot, '.github/workflows'));
  walk(join(repoRoot, '.github/actions'));
  return files;
}

// Adds `path` and, for JavaScript modules, every relative import it reaches.
function addWithImports(path, repoRoot, found) {
  if (found.has(path) || TEST_FILE.test(path)) return;
  const full = join(repoRoot, path);
  if (!existsSync(full)) return;
  found.add(path);
  if (!/\.[cm]?js$/.test(path)) return;
  for (const [, spec] of readFileSync(full, 'utf8').matchAll(RELATIVE_IMPORT)) {
    const target = posix.normalize(posix.join(posix.dirname(path), spec));
    if (!target.startsWith('..')) addWithImports(target, repoRoot, found);
  }
}

/**
 * Every existing, non-test script that a workflow or composite action runs,
 * plus the modules those scripts import, as sorted repository-relative paths.
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function referencedScripts(repoRoot) {
  const found = new Set();
  for (const file of workflowFiles(repoRoot)) {
    for (const [, path] of readFileSync(file, 'utf8').matchAll(SCRIPT_REF)) {
      addWithImports(path, repoRoot, found);
    }
  }
  return [...found].sort();
}

/**
 * @param {string} repoRoot
 * @returns {{ checked: string[], unowned: string[] }}
 */
export function checkCodeownersCoverage(repoRoot = REPO_ROOT) {
  const rules = parseCodeowners(readFileSync(join(repoRoot, '.github/CODEOWNERS'), 'utf8'));
  const checked = referencedScripts(repoRoot);
  return { checked, unowned: checked.filter((path) => !isOwned(path, rules)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { checked, unowned } = checkCodeownersCoverage();
  if (unowned.length > 0) {
    console.error('Scripts run by workflows but not owned in .github/CODEOWNERS:');
    for (const path of unowned) console.error(`  - ${path}`);
    console.error('Add each one to CODEOWNERS: an unowned script can rewrite what its job decides or does.');
    process.exit(1);
  }
  console.log(`✓ CODEOWNERS coverage guard passed — ${checked.length} workflow-run scripts are owned.`);
}
