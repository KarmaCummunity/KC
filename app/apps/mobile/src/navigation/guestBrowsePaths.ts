// Dedicated guest routes only. /post, /create, /chat and member tabs stay gated.
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const GUEST_POST = new RegExp(`^/browse/post/${UUID}/?$`);
export function isGuestBrowsePath(path: string): boolean {
  return path === '/browse' || path === '/browse/' || GUEST_POST.test(path);
}
export function guestMemberIntent(postId?: string): string | null {
  return postId && GUEST_POST.test(`/browse/post/${postId}`) ? `/post/${postId}` : null;
}
