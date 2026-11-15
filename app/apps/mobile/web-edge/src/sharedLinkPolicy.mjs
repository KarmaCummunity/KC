// The decision table for a request to a shared link (`/post/<id>`, `/user/<handle>`).
// Pure so it can be tested without a Workers runtime.
//
// Order of the answer a visitor gets:
//   1. a link-preview crawler          → the Open Graph card
//   2. a phone browser, store known    → a redirect to that store (the app is not installed,
//                                        otherwise the OS would have opened it before this ran)
//   3. anyone else                     → the web page (the SPA)
//
// `?web=1` always forces the web page: it is the "continue on the website" escape hatch and the
// guard against a redirect loop for someone who deliberately has no app.

import { classifyUserAgent } from './userAgent.mjs';

/** Query flag that opts out of the store redirect. */
export const FORCE_WEB_PARAM = 'web';

/**
 * @param {{ userAgent: string | null, search: URLSearchParams, storeLinks: { ios: string, android: string } }} input
 * @returns {{ kind: 'og' } | { kind: 'store', url: string } | { kind: 'web' }}
 */
export function decideSharedLinkAction({ userAgent, search, storeLinks }) {
  const agent = classifyUserAgent(userAgent);
  if (agent === 'crawler') return { kind: 'og' };
  if (search.get(FORCE_WEB_PARAM) === '1') return { kind: 'web' };
  if (agent === 'ios' && storeLinks.ios) return { kind: 'store', url: storeLinks.ios };
  if (agent === 'android' && storeLinks.android) return { kind: 'store', url: storeLinks.android };
  return { kind: 'web' };
}
