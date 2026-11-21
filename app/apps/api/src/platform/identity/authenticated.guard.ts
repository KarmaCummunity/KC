import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../errors/ApiError';
import { ACCESS_TOKEN_VERIFIER, type AccessTokenVerifier, InvalidAccessTokenError } from './accessTokenVerifier';
import type { CallerIdentity } from './callerIdentity';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `AuthenticatedGuard`; read it with the `@Caller()` decorator. */
    identity?: CallerIdentity;
  }
}

const BEARER = /^Bearer (\S+)$/;

/**
 * Lets a request through only with a valid access token and records who the
 * caller is. Every rejection is the same `401 unauthorized`: the reason goes
 * to the log, so a caller cannot probe which check failed.
 */
@Injectable()
export class AuthenticatedGuard implements CanActivate {
  constructor(@Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    if (!token) throw new ApiError('unauthorized', 401, 'no bearer token');

    try {
      request.identity = await this.verifier.verify(token);
    } catch (error) {
      if (!(error instanceof InvalidAccessTokenError)) throw error;
      request.log.info({ reason: error.message }, 'access token rejected');
      throw new ApiError('unauthorized', 401, error.message);
    }
    return true;
  }
}
