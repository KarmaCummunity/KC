// The link a WhatsApp reply gives to finish a bot draft in the app. It is the owner's edit
// screen of the post, the same routes as the app's hrefForPostEdit (postEditNavigation.ts):
// items posts edit in `/edit-post/<id>`, the other listing worlds (food, …) in
// `/edit-listing/<id>`. The web origin is the app's public one (EXPO_PUBLIC_WEB_BASE_URL).

export const DEFAULT_APP_BASE_URL = 'https://karma-community-kc.com';

/** The edit link of a post, on `base` (trailing slashes ignored). */
export function postEditLink(postId: string, worldSlug: string | null | undefined, base = DEFAULT_APP_BASE_URL): string {
  let end = base.length;
  while (end > 0 && base[end - 1] === '/') end -= 1;
  const route = !worldSlug || worldSlug === 'items' ? 'edit-post' : 'edit-listing';
  return `${base.slice(0, end) || DEFAULT_APP_BASE_URL}/${route}/${encodeURIComponent(postId)}`;
}
