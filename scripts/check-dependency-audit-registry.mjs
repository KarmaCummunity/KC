// Registry client for the dependency audit (#1373). Asks the npm registry's
// bulk advisory endpoint — the one `npm audit` itself uses — which advisories
// affect the inventory, then matches each advisory to the exact versions it
// affects. The legacy audit endpoint `pnpm audit` 9 calls is being retired
// (HTTP 410), which is why the audit no longer goes through pnpm.

import semver from 'semver';

export const BULK_ADVISORY_URL = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk';

// Package names per request: keeps each body well under registry limits.
const CHUNK_SIZE = 400;
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = Object.freeze([2_000, 4_000, 8_000]);
const GHSA_IN_URL = /(GHSA(?:-[0-9a-z]{4}){3})$/i;

/**
 * One advisory that affects one installed version.
 * @typedef {{
 *   advisory: string, severity: string, title: string, url: string,
 *   package: string, version: string, sources: string[],
 * }} Finding
 */

/** Raised when the registry cannot be reached or answers with an error. */
export class AuditRegistryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuditRegistryError';
  }
}

/** Status codes worth retrying: rate limiting and server-side failures. */
function isRetryable(status) {
  return status === 429 || status >= 500;
}

/**
 * POSTs one chunk, retrying network errors, 429 and 5xx with backoff. Any
 * other error status fails at once (a malformed request will not heal).
 * @param {Record<string, string[]>} body package name -> versions
 * @param {{ fetchImpl: typeof fetch, sleep: (ms: number) => Promise<void> }} io
 */
async function postChunk(body, { fetchImpl, sleep }) {
  let lastError = 'no attempt made';
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    try {
      const response = await fetchImpl(BULK_ADVISORY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return await response.json();
      lastError = `HTTP ${response.status}`;
      if (!isRetryable(response.status)) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new AuditRegistryError(`npm bulk advisory request failed: ${lastError}`);
}

/**
 * Fetches the advisories for every package in the inventory.
 * @param {Map<string, Map<string, string[]>>} packages name -> version -> files
 * @param {{ fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void> }} [io]
 * @returns {Promise<Map<string, object[]>>} name -> raw registry advisories
 */
export async function fetchAdvisories(packages, io = {}) {
  const deps = {
    fetchImpl: io.fetchImpl ?? fetch,
    sleep: io.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
  const names = [...packages.keys()].sort();
  const advisories = new Map();
  for (let start = 0; start < names.length; start += CHUNK_SIZE) {
    const body = {};
    for (const name of names.slice(start, start + CHUNK_SIZE)) {
      body[name] = [...packages.get(name).keys()];
    }
    const answer = await postChunk(body, deps);
    for (const [name, list] of Object.entries(answer ?? {})) {
      if (Array.isArray(list) && list.length > 0) advisories.set(name, list);
    }
  }
  return advisories;
}

/**
 * The advisory's stable ID: its GHSA ID when the registry links one (all
 * GitHub-reviewed advisories), else the registry's numeric ID.
 * @param {{ id?: number, url?: string }} advisory
 */
export function advisoryId(advisory) {
  const match = GHSA_IN_URL.exec(advisory.url ?? '');
  return match ? `GHSA${match[1].slice(4).toLowerCase()}` : `npm-${advisory.id}`;
}

/**
 * Whether a version falls in an advisory's vulnerable range. A range semver
 * cannot parse counts as affected, so an odd advisory blocks instead of
 * slipping through.
 * @param {string} version
 * @param {string} range
 */
export function isAffected(version, range) {
  if (semver.validRange(range, { loose: true }) === null) return true;
  return semver.satisfies(version, range, { loose: true, includePrerelease: true });
}

/**
 * The findings one advisory produces: one per installed version it affects.
 * @param {string} name package name
 * @param {object} advisory raw registry advisory
 * @param {Map<string, string[]>} versions version -> files that record it
 * @returns {Finding[]}
 */
function findingsForAdvisory(name, advisory, versions) {
  const range = String(advisory.vulnerable_versions ?? '*');
  return [...versions]
    .filter(([version]) => isAffected(version, range))
    .map(([version, sources]) => ({
      advisory: advisoryId(advisory),
      severity: String(advisory.severity ?? 'unknown').toLowerCase(),
      title: String(advisory.title ?? ''),
      url: String(advisory.url ?? ''),
      package: name,
      version,
      sources: [...sources],
    }));
}

/**
 * Matches the registry's advisories to the installed versions they affect.
 * @param {Map<string, Map<string, string[]>>} packages name -> version -> files
 * @param {Map<string, object[]>} advisories name -> raw registry advisories
 * @returns {Finding[]} sorted by advisory, package and version
 */
export function matchFindings(packages, advisories) {
  const findings = [];
  for (const [name, list] of advisories) {
    const versions = packages.get(name) ?? new Map();
    for (const advisory of list) findings.push(...findingsForAdvisory(name, advisory, versions));
  }
  const key = (f) => `${f.advisory}\u0000${f.package}\u0000${f.version}`;
  return findings.sort((a, b) => key(a).localeCompare(key(b)));
}
