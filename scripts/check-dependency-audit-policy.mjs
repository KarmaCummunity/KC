// Policy for the dependency audit (#1373): which findings block, and the
// rules every reviewed exception in check-dependency-audit.allowlist.json
// must follow.
//
// A high or critical advisory blocks unless an active exception names that
// exact advisory and package. Every exception carries a reason, the date it
// was reviewed and an expiry at most MAX_EXCEPTION_DAYS later, so the list
// cannot grow silently: an expired exception stops excusing its finding and
// the audit fails until someone re-reviews it. The allowlist is code-owned
// (`/scripts/check-*` in .github/CODEOWNERS), so adding one needs the owner.

/** Severities that fail the audit. Moderate and low are reported only. */
export const BLOCKING_SEVERITIES = Object.freeze(['critical', 'high']);

/** Longest time an exception stays valid before it must be reviewed again. */
export const MAX_EXCEPTION_DAYS = 90;

const MIN_REASON_LENGTH = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const ADVISORY_ID = /^GHSA(?:-[0-9a-z]{4}){3}$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const EXCEPTION_KEYS = Object.freeze(['advisory', 'package', 'reason', 'reviewed', 'expires']);

/**
 * A reviewed exception for one advisory in one package.
 * @typedef {{ advisory: string, package: string, reason: string, reviewed: string, expires: string }} Exception
 */

/**
 * Parses a `YYYY-MM-DD` calendar date to UTC milliseconds, or null when the
 * text is not a real date (`2026-02-30` is rejected, not rolled over).
 * @param {unknown} text
 */
export function parseIsoDate(text) {
  const match = ISO_DATE.exec(String(text));
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  const roundTrips =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return roundTrips ? ms : null;
}

/**
 * The problems with one exception entry; empty when it is valid.
 * @param {unknown} entry
 * @param {number} index position in the list, for messages
 * @returns {string[]}
 */
function exceptionErrors(entry, index) {
  const at = `exceptions[${index}]`;
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return [`${at}: must be an object`];
  }
  const errors = Object.keys(entry)
    .filter((key) => !EXCEPTION_KEYS.includes(key))
    .map((key) => `${at}: unknown field "${key}"`);
  if (!ADVISORY_ID.test(String(entry.advisory))) {
    errors.push(`${at}: "advisory" must be a lowercase GHSA ID (GHSA-xxxx-xxxx-xxxx)`);
  }
  if (!PACKAGE_NAME.test(String(entry.package))) {
    errors.push(`${at}: "package" must be an npm package name`);
  }
  if (typeof entry.reason !== 'string' || entry.reason.trim().length < MIN_REASON_LENGTH) {
    errors.push(`${at}: "reason" must explain the exception (at least ${MIN_REASON_LENGTH} characters)`);
  }
  errors.push(...expiryErrors(entry, at));
  return errors;
}

/**
 * Checks `reviewed` and `expires`: both real dates, expiry after the review
 * and no more than MAX_EXCEPTION_DAYS after it. Deterministic: it never reads
 * the clock, so a valid allowlist stays valid on every commit.
 * @param {{ reviewed?: unknown, expires?: unknown }} entry
 * @param {string} at
 */
function expiryErrors(entry, at) {
  const reviewed = parseIsoDate(entry.reviewed);
  const expires = parseIsoDate(entry.expires);
  if (reviewed === null) return [`${at}: "reviewed" must be a YYYY-MM-DD date`];
  if (expires === null) return [`${at}: "expires" must be a YYYY-MM-DD date`];
  if (expires <= reviewed) return [`${at}: "expires" must be after "reviewed"`];
  if (expires - reviewed > MAX_EXCEPTION_DAYS * DAY_MS) {
    return [`${at}: "expires" may be at most ${MAX_EXCEPTION_DAYS} days after "reviewed"`];
  }
  return [];
}

/**
 * Validates the parsed allowlist file.
 * @param {unknown} document
 * @returns {{ exceptions: Exception[], errors: string[] }}
 */
export function validateAllowlist(document) {
  const list = document?.exceptions;
  if (!Array.isArray(list)) {
    return { exceptions: [], errors: ['allowlist: top-level "exceptions" must be an array'] };
  }
  const errors = list.flatMap((entry, index) => exceptionErrors(entry, index));
  const seen = new Set();
  for (const entry of list) {
    const key = `${entry?.advisory} ${entry?.package}`;
    if (seen.has(key)) errors.push(`allowlist: duplicate exception for ${key}`);
    seen.add(key);
  }
  return { exceptions: errors.length === 0 ? list : [], errors };
}

/**
 * Splits the findings into the audit's verdict for the given day.
 *  - blocking: high/critical findings no active exception covers (a finding
 *    whose exception has expired carries it as `expiredException`);
 *  - excepted: high/critical findings an active exception covers;
 *  - informational: moderate/low findings, reported but never blocking;
 *  - stale: exceptions that no high/critical finding needs any more.
 * @param {import('./check-dependency-audit-registry.mjs').Finding[]} findings
 * @param {Exception[]} exceptions
 * @param {string} today `YYYY-MM-DD` (UTC)
 */
export function evaluate(findings, exceptions, today) {
  const todayMs = parseIsoDate(today);
  if (todayMs === null) throw new RangeError(`today must be YYYY-MM-DD, got "${today}"`);
  const byKey = new Map(exceptions.map((e) => [`${e.advisory} ${e.package}`, e]));
  const used = new Set();
  const verdict = { blocking: [], excepted: [], informational: [], stale: [] };
  for (const finding of findings) {
    if (!BLOCKING_SEVERITIES.includes(finding.severity)) {
      verdict.informational.push(finding);
      continue;
    }
    const exception = byKey.get(`${finding.advisory} ${finding.package}`);
    if (exception) used.add(exception);
    if (exception && parseIsoDate(exception.expires) >= todayMs) {
      verdict.excepted.push({ ...finding, exception });
    } else {
      verdict.blocking.push(exception ? { ...finding, expiredException: exception } : finding);
    }
  }
  verdict.stale = exceptions.filter((exception) => !used.has(exception));
  return verdict;
}
