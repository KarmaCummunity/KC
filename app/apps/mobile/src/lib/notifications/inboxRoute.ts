// KC#869 / TD-102 — where a tap on an in-app inbox row goes. The inbox and the push tap follow one
// rule: the route is derived from the row's typed `kind` against the closed allowlist
// (pushRouteAllowlist), with every id shape-checked. The stored `data.route` is never navigated to
// as-is, so a payload whose params do not match its screen (an event's `postId` on `/post/[id]`)
// still opens the right screen, and an unknown kind opens nothing.
import type { NotificationKind, PushData } from '@kc/domain';
import { resolvePushRoute, type ResolvedRoute } from './pushRouteAllowlist';

export function resolveInboxRoute(kind: string, data: Record<string, unknown>): ResolvedRoute | null {
  const payload: Partial<PushData> = {
    kind: kind as NotificationKind,
    route: typeof data.route === 'string' ? data.route : undefined,
    params: isStringRecord(data.params) ? data.params : undefined,
    chat_id: typeof data.chat_id === 'string' ? data.chat_id : undefined,
    listing_id: typeof data.listing_id === 'string' ? data.listing_id : undefined,
  };
  return resolvePushRoute(payload);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null
    && Object.values(value).every((entry) => typeof entry === 'string');
}
