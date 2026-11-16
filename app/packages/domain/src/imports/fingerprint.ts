// Placeholders survive canonicalization; they are swapped for control-character tokens while
// the rest is flattened, so punctuation stripping cannot eat their angle brackets.
const PLACEHOLDER = /<(phone|email|id|url)>/g;

/**
 * Canonical form of a scrubbed text for duplicate detection (FR-IMPORT-008 AC1-AC2): lower
 * case, digit runs collapsed to `#`, punctuation and emoji dropped, whitespace collapsed.
 * Hashing (SHA-256) is an adapter concern: the Edge Function uses `crypto.subtle`.
 */
export function canonicalFingerprintText(scrubbedText: string): string {
  return scrubbedText
    .toLowerCase()
    .replace(PLACEHOLDER, '\u0001$1\u0002')
    .replace(/\p{N}+/gu, '#')
    .replace(/[^\p{L}#\s\u0001\u0002]/gu, ' ')
    .replace(/\u0001(\w+)\u0002/g, '<$1>')
    .replace(/\s+/g, ' ')
    .trim();
}
