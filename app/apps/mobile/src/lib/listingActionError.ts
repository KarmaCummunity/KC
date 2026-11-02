// What the listing detail tells the viewer when a server action fails (#1412). The listing RPCs
// raise stable codes (ADR-002 §4): a known code gets its own copy; anything else keeps the
// generic "did not go through" copy and is reported, so an unexpected failure can be traced.
import { getSentryIfInit } from './observability/sentry';

/** Copy key shown for a failure the server does not explain. */
export const LISTING_ACTION_FAILED_KEY = 'marketplace.actionFailed';

/** Server codes raised by `start_listing_chat` (0464) and their copy. */
const KNOWN_FAILURES: Readonly<Record<string, string>> = {
  auth_required: 'marketplace.actionErrors.signInRequired',
  account_not_active: 'marketplace.actionErrors.accountNotActive',
  forbidden: 'marketplace.actionErrors.listingUnavailable',
  cannot_chat_self: 'marketplace.actionErrors.ownListing',
};

/** The server's code: the exception message the RPC raised (`raise exception '<code>'`). */
function serverCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message.trim() : null;
}

/** The copy key for a failed listing action. */
export function listingActionErrorKey(error: unknown): string {
  const code = serverCode(error);
  return (code && KNOWN_FAILURES[code]) || LISTING_ACTION_FAILED_KEY;
}

/** Reports a failure the copy does not explain; known, expected refusals are not reported. */
export function reportListingActionError(action: string, error: unknown): void {
  if (listingActionErrorKey(error) !== LISTING_ACTION_FAILED_KEY) return;
  const pg = typeof error === 'object' && error !== null ? (error as { code?: unknown }) : {};
  getSentryIfInit()?.captureException(error, {
    tags: { area: 'listing_detail', action, pg_code: typeof pg.code === 'string' ? pg.code : 'none' },
  });
}
