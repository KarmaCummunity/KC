// Dedicated guest routes only. /create, /chat and member tabs stay gated.
// Public post deep links remap to /browse/post so guests are not sent to a sign-up wall
// for content guest_posts can already serve (FR-AUTH-014, Apple 5.1.1(v)).
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const GUEST_POST = new RegExp(`^/browse/post/(${UUID})/?$`);
const MEMBER_POST = new RegExp(`^/post/(${UUID})/?$`);

/** True when the path is an allowlisted guest browse surface. */
export function isGuestBrowsePath(path: string): boolean {
  return path === '/browse' || path === '/browse/' || GUEST_POST.test(path);
}

/** Member post route to restore after the guest detail sign-in CTA. */
export function guestMemberIntent(postId?: string): string | null {
  return postId && GUEST_POST.test(`/browse/post/${postId}`) ? `/post/${postId}` : null;
}

/**
 * Signed-out paths that already have a guest-readable substitute.
 * Map and other-user profiles are not remapped: they need anon RPCs (see PR report).
 */
export function guestReadableRedirect(pathname: string): string | null {
  const post = pathname.match(MEMBER_POST);
  if (post) return `/browse/post/${post[1]}`;
  if (
    pathname === '/' ||
    pathname === '/(tabs)' ||
    pathname === '/(tabs)/' ||
    pathname === '/(tabs)/index'
  ) {
    return '/browse';
  }
  return null;
}
