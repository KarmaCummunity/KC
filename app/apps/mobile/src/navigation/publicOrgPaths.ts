/**
 * Public organization pages (FR-ORG-001 AC4, FR-FIN-020 AC4): a verified nonprofit's donations
 * and transparency page opens for a signed-out visitor from a shared link. The server grants its
 * three reads to `anon` (migration 0030). Pure: no expo-router import.
 */
const NONPROFIT_PAGE = /^\/donations\/money\/nonprofit\/[^/]+\/?$/;

export function isPublicOrgPagePath(pathname: string): boolean {
  return NONPROFIT_PAGE.test(pathname);
}
