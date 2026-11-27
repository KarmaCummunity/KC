// Guest write gating for Apple 5.1.1(v) / FR-AUTH-014 AC5.
// Reads stay open; writes are hidden or prompt sign-up only when tapped — never a wall on open.

/** How a write control behaves for a signed-out visitor. */
export type GuestWritePolicy = 'hide' | 'prompt';

/** What the UI should do for a write control given auth state and policy. */
export type GuestWriteVisibility = 'allow' | 'hide' | 'prompt';

/**
 * Resolve write-control visibility for the current session.
 * Authenticated members always `allow`. Guests either hide the control or prompt on tap.
 */
export function guestWriteVisibility(
  isAuthenticated: boolean,
  policy: GuestWritePolicy = 'prompt',
): GuestWriteVisibility {
  if (isAuthenticated) return 'allow';
  return policy === 'hide' ? 'hide' : 'prompt';
}

/** True when a write tap should open sign-in instead of running the action. */
export function shouldPromptGuestSignIn(isAuthenticated: boolean): boolean {
  return !isAuthenticated;
}
