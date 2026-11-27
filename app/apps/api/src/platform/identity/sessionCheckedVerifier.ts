import { type AccessTokenVerifier, InvalidAccessTokenError } from './accessTokenVerifier';
import type { SessionLiveness } from './sessionLiveness';

/**
 * A verifier for tokens this API issued itself (ADR-013 section 2): beyond
 * the signature, the session the token belongs to must still be live. A
 * member who signed out, reset their password or lost their session to a
 * copied refresh token is refused on their next request, not when the
 * token's hour is over.
 *
 * Every token of this API names its session, so one that names none is not
 * accepted. Failing to reach the database says nothing about the token and
 * surfaces as a server fault.
 */
export function withSessionCheck(verifier: AccessTokenVerifier, sessions: SessionLiveness): AccessTokenVerifier {
  return {
    async verify(token) {
      const caller = await verifier.verify(token);
      const sessionId = caller.claims.sid;
      if (typeof sessionId !== 'string') throw new InvalidAccessTokenError('names no session');
      if (!(await sessions.isLive(sessionId, caller.userId))) throw new InvalidAccessTokenError('session ended');
      return caller;
    },
  };
}
