/**
 * Guest browse path for a public author handle.
 * Empty / null / whitespace → null (author is not tappable; no dead end).
 */
export function guestAuthorPath(handle: string | null | undefined): string | null {
  const cleaned = handle?.trim().replace(/^@+/, '') ?? '';
  if (!cleaned) return null;
  return `/browse/user/${encodeURIComponent(cleaned)}`;
}
