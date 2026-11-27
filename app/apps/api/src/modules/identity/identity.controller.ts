import { Body, Controller, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { SessionResponse } from '@kc/infrastructure-api';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../../platform/errors/ApiError';
import { AuthenticatedGuard } from '../../platform/identity/authenticated.guard';
import { Caller } from '../../platform/identity/caller.decorator';
import type { CallerIdentity } from '../../platform/identity/callerIdentity';
import { RateLimiter } from '../../platform/rateLimit/rateLimiter';
import { EmailAccountService } from './emailAccountService';
import { SessionService } from './sessionService';

/**
 * Calls a minute one address may make to the routes that take a password or
 * send an email: far more than a person needs, far fewer than guessing takes.
 */
const CREDENTIAL_CALLS_PER_MINUTE = 20;

/**
 * The routes of KC's own identity (ADR-013), under `/v1/auth`. Their paths
 * and bodies are the shared wire format (`identityWire.ts` in
 * `@kc/infrastructure-api`).
 */
@Controller('auth')
export class IdentityController {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(EmailAccountService) private readonly emailAccounts: EmailAccountService,
    @Inject(RateLimiter) private readonly rateLimiter: RateLimiter,
  ) {}

  /** `{ refreshToken }` → a new session. The caller has no valid access token, so it is counted by address. */
  @Post('token')
  @HttpCode(200)
  async refresh(@Body() body: unknown, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<SessionResponse> {
    await this.count(request, reply, 'token');
    return this.sessions.refresh(body);
  }

  /** `{ email, password, redirectTo }` → `{}`, whether or not the address was free. */
  @Post('sign-up')
  @HttpCode(200)
  async signUp(@Body() body: unknown, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<Record<string, never>> {
    await this.count(request, reply, 'sign-up', CREDENTIAL_CALLS_PER_MINUTE);
    await this.emailAccounts.signUp(body);
    return {};
  }

  /** `{ email, password }` → a session. */
  @Post('sign-in')
  @HttpCode(200)
  async signIn(@Body() body: unknown, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<SessionResponse> {
    await this.count(request, reply, 'sign-in', CREDENTIAL_CALLS_PER_MINUTE);
    return this.emailAccounts.signIn(body);
  }

  /** `{ token, type }` of an emailed link → a session. */
  @Post('verify')
  @HttpCode(200)
  async verify(@Body() body: unknown, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<SessionResponse> {
    await this.count(request, reply, 'verify', CREDENTIAL_CALLS_PER_MINUTE);
    return this.emailAccounts.verify(body);
  }

  /** `{ email, redirectTo }` → `{}`, whatever the address. */
  @Post('resend')
  @HttpCode(200)
  async resend(@Body() body: unknown, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<Record<string, never>> {
    await this.count(request, reply, 'resend', CREDENTIAL_CALLS_PER_MINUTE);
    await this.emailAccounts.resendVerification(body);
    return {};
  }

  /** `{ email, redirectTo }` → `{}`, whatever the address. */
  @Post('recover')
  @HttpCode(200)
  async recover(@Body() body: unknown, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<Record<string, never>> {
    await this.count(request, reply, 'recover', CREDENTIAL_CALLS_PER_MINUTE);
    await this.emailAccounts.recover(body);
    return {};
  }

  /** `{ password }` → `{}`; every session of the caller ends. */
  @Post('password')
  @HttpCode(200)
  @UseGuards(AuthenticatedGuard)
  async setPassword(@Caller() caller: CallerIdentity, @Body() body: unknown): Promise<Record<string, never>> {
    await this.emailAccounts.setPassword(caller, body);
    return {};
  }

  /** `{ displayName?, avatarUrl? }` → `{}`. */
  @Post('profile')
  @HttpCode(200)
  @UseGuards(AuthenticatedGuard)
  async updateProfile(@Caller() caller: CallerIdentity, @Body() body: unknown): Promise<Record<string, never>> {
    await this.emailAccounts.updateProfile(caller, body);
    return {};
  }

  /** `{ scope: 'device' | 'everywhere' }` → `{}`. */
  @Post('sign-out')
  @HttpCode(200)
  @UseGuards(AuthenticatedGuard)
  async signOut(@Caller() caller: CallerIdentity, @Body() body: unknown): Promise<Record<string, never>> {
    await this.sessions.signOut(caller, body);
    return {};
  }

  /**
   * Counts a call that carries no access token against the address it came
   * from, and marks its answer as not to be stored by anything in between: a
   * session is the member's alone.
   * @param limit Calls a minute this route allows one address; the API's general allowance when absent.
   * @throws ApiError `429 too_many_requests`, with `retry-after`.
   */
  private async count(request: FastifyRequest, reply: FastifyReply, route: string, limit?: number): Promise<void> {
    const decision = await this.rateLimiter.check(`auth:${route}:${request.ip}`, limit);
    if (!decision.allowed) {
      reply.header('retry-after', decision.retryAfterSeconds);
      throw new ApiError('too_many_requests', 429, `auth.${route}`);
    }
    reply.header('cache-control', 'no-store');
  }
}
