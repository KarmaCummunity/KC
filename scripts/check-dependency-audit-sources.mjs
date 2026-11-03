// Inventory for the dependency audit (#1373): every npm package version the
// repository can install or import, read from the committed lockfiles and from
// the pinned npm imports of the Edge Functions.
//
// Lockfiles are the only reliable record of what is installed (transitive
// dependencies and `pnpm.overrides` included), so the audit reads them rather
// than the package.json ranges. A lockfile in a format this module does not
// know fails loudly: silently auditing nothing would pass every finding.

import semver from 'semver';
import { parse as parseYaml } from 'yaml';

/** Lockfile basenames the audit reads, wherever they live in the repository. */
export const LOCKFILE_NAMES = Object.freeze(['pnpm-lock.yaml', 'package-lock.json']);

/** Edge Function sources (Deno) that import npm packages by URL or `npm:`. */
export const EDGE_FUNCTIONS_DIR = 'supabase/functions/';
const EDGE_SOURCE = /\.(?:[cm]?[jt]s|tsx)$/;

// `https://esm.sh/<name>@<version>` and `npm:<name>@<version>`; a scoped name
// keeps its `@scope/` prefix. The version ends at the first path, query or
// quote character, so `.../supabase-js@2.45.4?target=deno` yields `2.45.4`.
const PACKAGE_NAME = '((?:@[\\w.-]+\\/)?[\\w.-]+)';
const VERSION_TOKEN = '([^/?#\'"`\\s]+)';
const EDGE_IMPORT = new RegExp(
  `(?:https:\\/\\/esm\\.sh\\/|\\bnpm:)${PACKAGE_NAME}@${VERSION_TOKEN}`,
  'g',
);

/**
 * One installed (or imported) package version and the file that records it.
 * @typedef {{ name: string, version: string, source: string }} PackageRef
 */

/**
 * A dependency the audit cannot check: no exact registry version is recorded
 * (a version range, a git or tarball dependency).
 * @typedef {{ specifier: string, source: string }} Unauditable
 */

/** Raised when a source file is in a format the audit cannot read. */
export class AuditSourceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuditSourceError';
  }
}

/**
 * Sorts one `name@version` into an auditable ref or an unauditable specifier.
 * @param {string} name
 * @param {string} version
 * @param {string} source
 * @param {{ refs: PackageRef[], unauditable: Unauditable[] }} into
 */
function addPackage(name, version, source, into) {
  if (semver.valid(version)) {
    into.refs.push({ name, version, source });
  } else {
    into.unauditable.push({ specifier: `${name}@${version}`, source });
  }
}

/**
 * Reads a pnpm v9 lockfile. Its `packages` keys are `name@version` (scoped
 * names start with `@`, so the version follows the last `@`); workspace
 * packages live under `importers` and are not registry packages.
 * @param {string} text
 * @param {string} source repository-relative path, for reporting
 */
export function parsePnpmLock(text, source) {
  const lock = parseYaml(text);
  const version = String(lock?.lockfileVersion ?? '');
  if (!version.startsWith('9.')) {
    throw new AuditSourceError(
      `${source}: pnpm lockfileVersion "${version}" is not supported (expected 9.x)`,
    );
  }
  const into = { refs: [], unauditable: [] };
  for (const key of Object.keys(lock.packages ?? {})) {
    const at = key.lastIndexOf('@');
    if (at <= 0) {
      into.unauditable.push({ specifier: key, source });
      continue;
    }
    addPackage(key.slice(0, at), key.slice(at + 1), source, into);
  }
  return into;
}

/**
 * Reads an npm v2/v3 lockfile. Every `packages` key except the root (`""`) is
 * an install path (`node_modules/a/node_modules/b`); an aliased install
 * records its real package name in `name`. Workspace links carry no version.
 * @param {string} text
 * @param {string} source repository-relative path, for reporting
 */
export function parseNpmLock(text, source) {
  const lock = JSON.parse(text);
  if (![2, 3].includes(lock?.lockfileVersion) || typeof lock.packages !== 'object') {
    throw new AuditSourceError(
      `${source}: npm lockfileVersion "${lock?.lockfileVersion}" is not supported (expected 2 or 3)`,
    );
  }
  const into = { refs: [], unauditable: [] };
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === '' || entry.link) continue;
    const marker = path.lastIndexOf('node_modules/');
    const name = entry.name ?? path.slice(marker + 'node_modules/'.length);
    addPackage(name, String(entry.version ?? ''), source, into);
  }
  return into;
}

/**
 * Reads the npm packages an Edge Function imports through esm.sh or `npm:`.
 * Only the imported package itself is visible here (esm.sh resolves its
 * dependencies server-side and there is no Deno lockfile), and a range such
 * as `@2` cannot be audited, so it is reported as unauditable.
 * @param {string} text
 * @param {string} source repository-relative path, for reporting
 */
export function parseEdgeFunctionImports(text, source) {
  const into = { refs: [], unauditable: [] };
  for (const [, name, version] of text.matchAll(EDGE_IMPORT)) {
    addPackage(name, version, source, into);
  }
  return into;
}

/**
 * Picks the parser for one repository path, or none when the audit ignores it.
 * @param {string} path repository-relative path
 * @returns {((text: string, source: string) => { refs: PackageRef[], unauditable: Unauditable[] }) | null}
 */
export function parserFor(path) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (base === 'pnpm-lock.yaml') return parsePnpmLock;
  if (base === 'package-lock.json') return parseNpmLock;
  if (path.startsWith(EDGE_FUNCTIONS_DIR) && EDGE_SOURCE.test(path)) {
    return parseEdgeFunctionImports;
  }
  return null;
}

/**
 * Builds the inventory from the tracked files: refs grouped by package name
 * and version, with every file that records each version.
 * @param {string[]} trackedPaths repository-relative paths (`git ls-files`)
 * @param {(path: string) => string} readFile
 * @returns {{ packages: Map<string, Map<string, string[]>>, unauditable: Unauditable[], sources: string[] }}
 */
export function collectInventory(trackedPaths, readFile) {
  const packages = new Map();
  const unauditable = [];
  const sources = [];
  for (const path of [...trackedPaths].sort()) {
    const parse = parserFor(path);
    if (!parse) continue;
    const result = parse(readFile(path), path);
    if (result.refs.length > 0 || LOCKFILE_NAMES.some((name) => path.endsWith(name))) {
      sources.push(path);
    }
    unauditable.push(...result.unauditable);
    for (const ref of result.refs) {
      const versions = packages.get(ref.name) ?? new Map();
      const files = versions.get(ref.version) ?? [];
      if (!files.includes(ref.source)) files.push(ref.source);
      versions.set(ref.version, files);
      packages.set(ref.name, versions);
    }
  }
  return { packages, unauditable, sources };
}
