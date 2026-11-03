const TEST_PREFIX = /^\s*(\[(demo|test|seed|e2e)\]\s*)+/i;
const ISO_TIMESTAMP = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?\b/;

/** Strips seed/test prefixes like "[DEMO]" / "[e2e]" from user-facing titles. */
export function cleanDisplayTitle(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(TEST_PREFIX, '').trim();
}

/** True for automated-test listings (e2e prefix or raw ISO-timestamp titles) that real users must never see. */
export function isTestListingTitle(raw: string | null | undefined): boolean {
  if (!raw) return false;
  if (/^\s*\[e2e\]/i.test(raw)) return true;
  return ISO_TIMESTAMP.test(raw);
}
