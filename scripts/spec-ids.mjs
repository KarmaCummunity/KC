#!/usr/bin/env node
/**
 * Merge-time allocation of registry IDs (D#, TD-#, S#, G#, engineering D-#).
 *
 * Parallel branches that each take "the next free number" collide on merge. So a
 * PR never picks a number: it adds the registry row with a placeholder such as
 * `{{TD:short-slug}}` and cites that same placeholder anywhere else. After the
 * merge into `dev`, `assign` swaps every placeholder for the next free number of
 * its registry and rewrites all references in one commit
 * (.github/workflows/bump-version-on-merge.yml).
 *
 * Usage:
 *   node scripts/spec-ids.mjs check    CI guard: unique numbers, valid placeholders
 *   node scripts/spec-ids.mjs assign   rewrite placeholders to numbers in place
 * Env: SPEC_IDS_ROOT — override the repository root (tests).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(process.env.SPEC_IDS_ROOT || resolve(here, '..'));

/**
 * One entry per ID namespace.
 * - `key`: the placeholder name (`{{TD:slug}}`); `idPrefix`: what the final ID starts with.
 * - `row`: how an entry starts — a table row (`| D12 | … |`) or a heading (`## D-12 — …`).
 * - `historyFiles`: closed entries whose numbers must never be handed out again.
 */
export const REGISTRIES = [
  { key: 'D', idPrefix: 'D', row: 'table', file: 'docs/spec/90_decisions_log.md', historyFiles: [] },
  {
    key: 'TD',
    idPrefix: 'TD-',
    row: 'table',
    file: 'docs/SSOT/TECH_DEBT.md',
    historyFiles: ['docs/SSOT/archive/TECH_DEBT-history.md'],
  },
  { key: 'S', idPrefix: 'S', row: 'table', file: 'docs/spec/91_kc_fills_pending.md', historyFiles: [] },
  { key: 'G', idPrefix: 'G', row: 'table', file: 'docs/spec/93_implementation_gaps.md', historyFiles: [] },
  // Engineering decisions; `D-` would read as a product decision, hence `ENG`.
  { key: 'ENG', idPrefix: 'D-', row: 'heading', file: 'docs/SSOT/DECISIONS.md', historyFiles: [] },
];

/**
 * Duplicates that predate merge-time allocation. Renumbering them would silently
 * change what existing citations point at, so they are tolerated, and only them.
 */
export const KNOWN_DUPLICATES = { TD: [200, 201, 204, 233], ENG: [38, 40, 41] };

/**
 * Regex fragments around an entry's ID. A table cell may carry a trailing `*`
 * ("needs depth"); a heading ID must not run into more digits (`## D-12 — …`).
 */
const ROW_SHAPES = {
  table: { start: '^\\|\\s*', numberEnd: '\\*?\\s*\\|', placeholderEnd: '\\*?\\s*\\|' },
  heading: { start: '^#{2,3}\\s+', numberEnd: '(?!\\d)', placeholderEnd: '' },
};

/** Files that document the placeholder syntax itself and must never be rewritten. */
export const IGNORED_FILES = new Set(['CLAUDE.md', 'scripts/spec-ids.mjs', 'scripts/spec-ids.test.mjs']);

const PLACEHOLDER_KEYS = REGISTRIES.map((registry) => registry.key).join('|');
const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*';
// A well-formed placeholder, e.g. `{{TD:ci-gate-window}}`.
const PLACEHOLDER = new RegExp(`\\{\\{(${PLACEHOLDER_KEYS}):(${SLUG})\\}\\}`, 'g');
// Anything that starts like a placeholder; each match must also be well-formed.
const PLACEHOLDER_CANDIDATE = new RegExp(`\\{\\{(?:${PLACEHOLDER_KEYS}):[^\\s}]*\\}{0,2}`, 'g');
// Used by `git grep` to find the files worth reading.
const PLACEHOLDER_GREP = `\\{\\{(${PLACEHOLDER_KEYS}):`;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Formats a number as an ID of the registry, e.g. 231 -> `TD-231`. */
export function formatId(registry, number) {
  return `${registry.idPrefix}${number}`;
}

/** Numbers of the registry's numbered entries, in file order. */
export function rowNumbers(text, registry) {
  const shape = ROW_SHAPES[registry.row];
  const row = new RegExp(`${shape.start}${escapeRegExp(registry.idPrefix)}(\\d+)${shape.numberEnd}`, 'gm');
  return [...text.matchAll(row)].map((match) => Number(match[1]));
}

/** Slugs of the registry's placeholder entries (`| {{D:slug}} | … |`), in file order. */
export function placeholderRows(text, registry) {
  const shape = ROW_SHAPES[registry.row];
  const row = new RegExp(`${shape.start}\\{\\{${registry.key}:(${SLUG})\\}\\}${shape.placeholderEnd}`, 'gm');
  return [...text.matchAll(row)].map((match) => match[1]);
}

/** Every well-formed placeholder in a text, as `{ token, key, slug }`. */
export function findPlaceholders(text) {
  return [...text.matchAll(PLACEHOLDER)].map(([token, key, slug]) => ({ token, key, slug }));
}

/** Placeholder-like fragments that are not well-formed (bad slug, missing brace, …). */
export function findMalformed(text) {
  const valid = new RegExp(`^${PLACEHOLDER.source}$`);
  return [...text.matchAll(PLACEHOLDER_CANDIDATE)].map(([fragment]) => fragment).filter((fragment) => !valid.test(fragment));
}

/**
 * Validates the registries and every file that mentions a placeholder.
 * @param {Map<string, string>} registryTexts registry/history path -> content
 * @param {Map<string, string>} placeholderTexts path -> content, for files citing placeholders
 * @returns {string[]} human-readable errors; empty when everything is consistent
 */
export function validate(registryTexts, placeholderTexts) {
  const errors = [];
  const defined = new Set();

  for (const registry of REGISTRIES) {
    const text = registryTexts.get(registry.file) ?? '';
    const allowed = new Set(KNOWN_DUPLICATES[registry.key] ?? []);
    const seen = new Set();
    for (const number of rowNumbers(text, registry)) {
      if (seen.has(number) && !allowed.has(number)) {
        errors.push(`${registry.file}: ${formatId(registry, number)} is used by more than one entry`);
      }
      seen.add(number);
    }
    for (const slug of placeholderRows(text, registry)) {
      const token = `{{${registry.key}:${slug}}}`;
      if (defined.has(token)) errors.push(`${registry.file}: ${token} is defined by more than one entry`);
      defined.add(token);
    }
  }

  for (const [path, text] of placeholderTexts) {
    for (const fragment of findMalformed(text)) {
      errors.push(`${path}: malformed placeholder ${fragment} (expected {{${PLACEHOLDER_KEYS.replaceAll('|', '/')}:lowercase-slug}})`);
    }
    for (const { token, key } of findPlaceholders(text)) {
      if (defined.has(token)) continue;
      const registry = REGISTRIES.find((entry) => entry.key === key);
      errors.push(`${path}: ${token} has no entry in ${registry.file}`);
    }
  }
  return [...new Set(errors)];
}

/**
 * Picks the number each placeholder row receives: the registry's highest number
 * ever used (active rows and history) plus one, in row order.
 * @param {Map<string, string>} registryTexts registry/history path -> content
 * @returns {Map<string, string>} placeholder token -> final ID
 */
export function planAssignments(registryTexts) {
  const plan = new Map();
  for (const registry of REGISTRIES) {
    const text = registryTexts.get(registry.file) ?? '';
    const used = [registry.file, ...registry.historyFiles].flatMap((path) =>
      rowNumbers(registryTexts.get(path) ?? '', registry),
    );
    let next = Math.max(0, ...used) + 1;
    for (const slug of placeholderRows(text, registry)) {
      plan.set(`{{${registry.key}:${slug}}}`, formatId(registry, next));
      next += 1;
    }
  }
  return plan;
}

/** Replaces every planned placeholder in a text with its final ID. */
export function applyAssignments(text, plan) {
  return text.replace(PLACEHOLDER, (token) => plan.get(token) ?? token);
}

/** Tracked text files (relative paths) that contain a placeholder, minus the ignored ones. */
function filesCitingPlaceholders(root) {
  try {
    const output = execFileSync('git', ['grep', '-l', '-I', '-E', PLACEHOLDER_GREP], { cwd: root, encoding: 'utf8' });
    return output.split('\n').filter((path) => path && !IGNORED_FILES.has(path));
  } catch (error) {
    if (error.status === 1) return []; // `git grep` exits 1 when nothing matches.
    throw error;
  }
}

/** Reads the given repo-relative paths into a map; a missing file reads as empty. */
function readTexts(root, paths) {
  const read = (path) => {
    try {
      return readFileSync(resolve(root, path), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return '';
      throw error;
    }
  };
  return new Map(paths.map((path) => [path, read(path)]));
}

/** Loads registries and placeholder-citing files from disk for `check` / `assign`. */
export function loadRepo(root = repoRoot) {
  const registryPaths = REGISTRIES.flatMap((registry) => [registry.file, ...registry.historyFiles]);
  return {
    registryTexts: readTexts(root, registryPaths),
    placeholderTexts: readTexts(root, filesCitingPlaceholders(root)),
  };
}

function main() {
  const command = process.argv[2];
  if (command !== 'check' && command !== 'assign') {
    process.stderr.write('Usage: node scripts/spec-ids.mjs <check|assign>\n');
    process.exit(2);
  }

  const { registryTexts, placeholderTexts } = loadRepo();
  const errors = validate(registryTexts, placeholderTexts);
  if (errors.length > 0) {
    process.stderr.write(`Spec ID check failed:\n${errors.map((error) => `  - ${error}`).join('\n')}\n`);
    process.stderr.write('New registry entries take a placeholder such as {{TD:short-slug}}; numbers are assigned on merge (CLAUDE.md §4).\n');
    process.exit(1);
  }

  const plan = planAssignments(registryTexts);
  if (command === 'check') {
    process.stdout.write(`Spec IDs OK (${plan.size} placeholder(s) pending assignment on merge).\n`);
    return;
  }

  for (const [path, text] of placeholderTexts) {
    const rewritten = applyAssignments(text, plan);
    if (rewritten !== text) writeFileSync(resolve(repoRoot, path), rewritten, 'utf8');
  }
  for (const [token, id] of plan) process.stdout.write(`${token} -> ${id}\n`);
  if (plan.size === 0) process.stdout.write('No spec ID placeholders to assign.\n');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
