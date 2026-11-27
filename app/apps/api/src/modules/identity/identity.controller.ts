import { Body, Controller, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { SessionResponse } from '@kc/infrastructure-api';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../../platform/errors/ApiError';
import { AuthenticatedGuard } from '../../platform/identity/authenticated.guard';
import { Caller } from '../../platform/identity/caller.decorator';
import type { CallerIdentity } from '../../platform/identity/callerIdentity';
import { RateLimiter } from '../../platform/rateLimit/rateLimiter';
import { SessionService } from './sessionService';

/**
 * The routes of KC's own identity (ADR-013), under `/v1/auth`. Their paths
 * and bodies are the shared wire format (`identityWire.ts` in
 * `@kc/infrastructure-api`).
 */
@Controller('auth')
export class IdentityController {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(RateLimiter) private readonly rateLimiter: RateLimiter,
  ) {}

  /** `{ refreshToken }` → a new session. The caller has no valid access token, so it is counted by address. */
  @Post('token')
  @HttpCode(200)
  async refresh(@Body() body: unknown, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<SessionResponse> {
    const limit = await this.rateLimiter.check(`auth:${request.ip}`);
    if (!limit.allowed) {
      reply.header('retry-after', limit.retryAfterSeconds);
      throw new ApiError('too_many_requests', 429, 'auth.token');
    }
    // A session is the member's alone: no cache between the API and the app may keep it.
    reply.header('cache-control', 'no-store');
    return this.sessions.refresh(body);
  }

  /** `{ scope: 'device' | 'everywhere' }` → `{}`. */
  @Post('sign-out')
  @HttpCode(200)
  @UseGuards(AuthenticatedGuard)
  async signOut(@Caller() caller: CallerIdentity, @Body() body: unknown): Promise<Record<string, never>> {
    await this.sessions.signOut(caller, body);
    return {};
  }
}
