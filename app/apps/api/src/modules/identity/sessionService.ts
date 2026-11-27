import { Inject, Injectable } from '@nestjs/common';
import type { SessionResponse } from '@kc/infrastructure-api';
import { type DatabaseSession, IdentityDatabase } from '../../platform/database/identityDatabase';
import { ApiError } from '../../platform/errors/ApiError';
import { ACCESS_TOKEN_ISSUER, type AccessTokenIssuer } from '../../platform/identity/accessTokenIssuer';
import type { CallerIdentity } from '../../platform/identity/callerIdentity';
import { type ContinuedSession, endSession, endSessionsOf, openSession, readSessionUser, type Rotation, rotateRefreshToken } from './sessionStore';

/** The longest text taken for a refresh token; a real one is 43 characters. */
const MAX_REFRESH_TOKEN_LENGTH = 200;

/**
 * The sessions of KC's own identity (ADR-013 section 2): what a sign-in
 * ends in, how a session is continued, and how it ends. On an API that
 * issues no tokens every method refuses with `503 not_configured`.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(IdentityDatabase) private readonly database: IdentityDatabase,
    @Inject(ACCESS_TOKEN_ISSUER) private readonly issuer: AccessTokenIssuer | null,
  ) {}

  /**
   * Opens a session for a member who proved who they are, inside the
   * sign-in's own transaction (as the service role).
   * @throws ApiError `503 not_configured`
   */
  async openFor(db: DatabaseSession, userId: string): Promise<SessionResponse> {
    this.requireIssuer();
    return this.responseFor(db, await openSession(db, userId));
  }

  /**
   * Continues a session: the refresh token is replaced and a new access
   * token issued.
   * @throws ApiError `400 invalid_request`; `401 invalid_refresh_token` for a token that is unknown, of a session
   *   that ended, or was replaced too long ago (which also ends its session); `503 not_configured`.
   */
  async refresh(body: unknown): Promise<SessionResponse> {
    this.requireIssuer();
    const { refreshToken } = (body ?? {}) as Record<string, unknown>;
    if (typeof refreshToken !== 'string' || refreshToken === '' || refreshToken.length > MAX_REFRESH_TOKEN_LENGTH) throw new ApiError('invalid_request', 400);
    // The refusal is thrown after the transaction committed: a reused token ends its session, and that must stay.
    const outcome = await this.database.runAsService(async (db): Promise<SessionResponse | Exclude<Rotation['outcome'], 'rotated'>> => {
      const rotation = await rotateRefreshToken(db, refreshToken);
      return rotation.outcome === 'rotated' ? this.responseFor(db, rotation) : rotation.outcome;
    });
    if (typeof outcome === 'string') throw new ApiError('invalid_refresh_token', 401, `refresh token ${outcome}`);
    return outcome;
  }

  /**
   * Ends the caller's session, or every session they have. Their access
   * tokens stop being accepted with it.
   * @throws ApiError `400 invalid_request`, `503 not_configured`.
   */
  async signOut(caller: CallerIdentity, body: unknown): Promise<void> {
    this.requireIssuer();
    const { scope } = (body ?? {}) as Record<string, unknown>;
    if (scope !== 'device' && scope !== 'everywhere') throw new ApiError('invalid_request', 400);
    const sessionId = caller.claims.sid as string;
    await this.database.runAsService(async (db) => {
      if (scope === 'everywhere') await endSessionsOf(db, caller.userId, 'signed_out_everywhere');
      else await endSession(db, sessionId, caller.userId, 'signed_out');
    });
  }

  private async responseFor(db: DatabaseSession, session: ContinuedSession): Promise<SessionResponse> {
    const user = await readSessionUser(db, session.userId);
    // The session's row references the member's, so this is a member removed inside this very transaction.
    if (!user) throw new ApiError('invalid_refresh_token', 401, 'the member no longer exists');
    const { token, expiresAt } = await this.requireIssuer().issue({ userId: session.userId, sessionId: session.sessionId });
    return { accessToken: token, refreshToken: session.refreshToken, expiresAt, user };
  }

  private requireIssuer(): AccessTokenIssuer {
    if (!this.issuer) throw new ApiError('not_configured', 503, 'this API issues no tokens');
    return this.issuer;
  }
}
