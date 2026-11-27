import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../errors/ApiError';
import { ACCESS_TOKEN_VERIFIER, type AccessTokenVerifier } from './accessTokenVerifier';
import type { CallerIdentity } from './callerIdentity';
import { resolveCaller } from './resolveCaller';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `AuthenticatedGuard`; read it with the `@Caller()` decorator. */
    identity?: CallerIdentity;
  }
}

/**
 * Lets a request through only with a valid access token and records who the
 * caller is.
 */
@Injectable()
export class AuthenticatedGuard implements CanActivate {
  constructor(@Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const caller = await resolveCaller(request, this.verifier);
    if (!caller) throw new ApiError('unauthorized', 401, 'no bearer token');
    request.identity = caller;
    return true;
  }
}
