import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { CallerIdentity } from './callerIdentity';

/** A handler asked for the caller on a route that no guard authenticated. */
export class MissingCallerError extends Error {
  constructor() {
    super('@Caller() needs AuthenticatedGuard on the route');
    this.name = 'MissingCallerError';
  }
}

/** Reads the identity `AuthenticatedGuard` put on the request. */
export function callerOf(request: Pick<FastifyRequest, 'identity'>): CallerIdentity {
  if (!request.identity) throw new MissingCallerError();
  return request.identity;
}

/**
 * Handler parameter: the signed-in caller. The route must be behind
 * `AuthenticatedGuard`; without it this throws instead of handing a handler
 * an undefined identity.
 */
export const Caller = createParamDecorator((_data: unknown, context: ExecutionContext): CallerIdentity =>
  callerOf(context.switchToHttp().getRequest<FastifyRequest>()),
);
