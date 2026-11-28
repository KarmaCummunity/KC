import type { FastifyRequest } from 'fastify';
import { ApiError } from '../errors/ApiError';
import { type AccessTokenVerifier, InvalidAccessTokenError } from './accessTokenVerifier';
import type { CallerIdentity } from './callerIdentity';

const BEARER = /^Bearer (\S+)$/;

/**
 * Who a request acts as: the signed-in caller its bearer token proves, or
 * null when it carries no `Authorization` header at all (a signed-out visitor).
 *
 * A header that is present but not a valid token is always refused, never
 * downgraded to "signed out": a client with a broken session must learn it.
 * Every rejection is the same `401 unauthorized`; the reason goes to the log,
 * so a caller cannot probe which check failed.
 */
export async function resolveCaller(
  request: Pick<FastifyRequest, 'headers' | 'log'>,
  verifier: AccessTokenVerifier,
): Promise<CallerIdentity | null> {
  const header = request.headers.authorization;
  if (header === undefined) return null;
  const token = BEARER.exec(header)?.[1];
  if (!token) throw new ApiError('unauthorized', 401, 'malformed Authorization header');

  try {
    return await verifier.verify(token);
  } catch (error) {
    if (!(error instanceof InvalidAccessTokenError)) throw error;
    request.log.info({ reason: error.message }, 'access token rejected');
    throw new ApiError('unauthorized', 401, error.message);
  }
}
