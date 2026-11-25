// Dedicated guest routes. /create, /chat and member tabs stay gated.
// Public deep links remap to /browse* so guests are not sent to a sign-up wall
// for content the guest_* RPCs can serve (FR-AUTH-014, Apple 5.1.1(v)).
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const GUEST_POST = new RegExp(`^/browse/post/(${UUID})/?$`);
const MEMBER_POST = new RegExp(`^/post/(${UUID})/?$`);
const GUEST_USER = /^\/browse\/user\/([^/]+)\/?$/;
const MEMBER_USER = /^\/user\/([^/]+)\/?$/;
const MEMBER_MAP = /^\/donations\/marketplace\/map\/?$/;

/** True when the path is an allowlisted guest browse surface. */
export function isGuestBrowsePath(path: string): boolean {
  const bare = path.split('?')[0] ?? path;
  return (
    bare === '/browse' ||
    bare === '/browse/' ||
    bare === '/browse/map' ||
    bare === '/browse/map/' ||
    GUEST_POST.test(bare) ||
    GUEST_USER.test(bare)
  );
}

/** Member post route to restore after the guest detail sign-in CTA. */
export function guestMemberIntent(postId?: string): string | null {
  return postId && GUEST_POST.test(`/browse/post/${postId}`) ? `/post/${postId}` : null;
}

/**
 * Signed-out paths that have a guest-readable substitute.
 * Map and other-user profiles remap once the guest_* RPCs exist (#2729).
 */
export function guestReadableRedirect(pathname: string): string | null {
  const bare = pathname.split('?')[0] ?? pathname;
  const post = bare.match(MEMBER_POST);
  if (post) return `/browse/post/${post[1]}`;
  const user = bare.match(MEMBER_USER);
  if (user) return `/browse/user/${encodeURIComponent(user[1]!)}`;
  if (MEMBER_MAP.test(bare)) return '/browse/map';
  if (
    bare === '/' ||
    bare === '/(tabs)' ||
    bare === '/(tabs)/' ||
    bare === '/(tabs)/index'
  ) {
    return '/browse';
  }
  return null;
}
