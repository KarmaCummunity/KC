import { Global, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../createApp';
import { IdentityRoutesModule } from '../../modules/identity/identityRoutes.module';
import { SessionModule } from '../../modules/session/session.module';
import { ApiConfigModule } from '../../platform/config/apiConfig.module';
import { DatabaseModule } from '../../platform/database/database.module';
import { IdentityModule } from '../../platform/identity/identity.module';
import { signingKeySetJson } from '../../platform/identity/__tests__/signingKeyFixtures';
import { RateLimiter } from '../../platform/rateLimit/rateLimiter';
import { API_DATABASE_URL, KC_DATABASE_URL } from './kcDatabase';
import { testConfig } from './testConfig';

/** The issuer address of the API under test: its own identity routes. */
export const OWN_ISSUER = 'https://api.kc.test/v1/auth';

/**
 * The API as the issuer of its members' tokens (ADR-013), on the KC test
 * schema: the real identity module with fresh signing keys, the identity
 * routes, and `GET /v1/session`, which answers who the database says a token
 * is. Only the rate limiter is replaced, by one that always allows.
 */
export async function startIdentityApp(): Promise<NestFastifyApplication> {
  @Global()
  @Module({
    providers: [{ provide: RateLimiter, useValue: { check: () => Promise.resolve({ allowed: true, retryAfterSeconds: 0 }) } }],
    exports: [RateLimiter],
  })
  class OpenRateLimitModule {}

  const config = testConfig({ databaseUrl: API_DATABASE_URL ?? KC_DATABASE_URL ?? '', authIssuer: OWN_ISSUER, authSigningKeys: await signingKeySetJson('test-key') });
  @Module({ imports: [ApiConfigModule.forRoot(config), DatabaseModule, IdentityModule, OpenRateLimitModule, IdentityRoutesModule, SessionModule] })
  class IdentityTestModule {}
  return createApp(IdentityTestModule, config);
}
