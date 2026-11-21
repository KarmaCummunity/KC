// How the shell reads the current route (FR-RESP-001 / FR-RESP-002, #1768).
//
// expo-router's `useSegments()` gives the route as a trail of segments. The shell decides by
// where a segment sits in that trail (its head), never by a segment that merely appears in it:
// `/post/[id]/settings` is a post route, not the settings screen.

export type ShellVariant = 'wide' | 'narrow';

/** A route group such as `(tabs)`: it shapes the layout tree and is not part of the URL. */
const isRouteGroup = (segment: string): boolean => segment.startsWith('(') && segment.endsWith(')');

/** The first segment that is part of the URL, or `undefined` at the root of the app. */
export function routeHead(segments: readonly string[]): string | undefined {
  return segments.find((segment) => !isRouteGroup(segment));
}

/** Top-level routes that are forms: their content column is capped at the narrow width. */
const NARROW_HEADS: ReadonlySet<string> = new Set(['settings', 'edit-profile', 'edit-post', 'edit-listing', 'create']);

/** Route groups whose every screen is a form: sign-in and onboarding. */
const NARROW_GROUPS: ReadonlySet<string> = new Set(['(auth)', '(onboarding)']);

/** The bare `auth` routes (outside the `(auth)` group) that are forms. */
const NARROW_AUTH_PAGES: ReadonlySet<string> = new Set(['verify', 'callback']);

/** The content width of the desktop shell for a route: narrow for form-style screens. */
export function resolveShellVariant(segments: readonly string[]): ShellVariant {
  const [first, second] = segments;
  if (first !== undefined && NARROW_GROUPS.has(first)) return 'narrow';
  if (first === 'auth' && second !== undefined && NARROW_AUTH_PAGES.has(second)) return 'narrow';
  const head = routeHead(segments);
  return head !== undefined && NARROW_HEADS.has(head) ? 'narrow' : 'wide';
}
