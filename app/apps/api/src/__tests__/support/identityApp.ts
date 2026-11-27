import { Global, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../createApp';
import type { EmailSender } from '../../modules/identity/emailSender';
import { IdentityRoutesModule } from '../../modules/identity/identityRoutes.module';
import { SessionModule } from '../../modules/session/session.module';
import { BackgroundModule } from '../../platform/background/background.module';
import { ApiConfigModule } from '../../platform/config/apiConfig.module';
import { DatabaseModule } from '../../platform/database/database.module';
import { IdentityModule } from '../../platform/identity/identity.module';
import { signingKeySetJson } from '../../platform/identity/__tests__/signingKeyFixtures';
import { APP_LOGGER, appLoggerProvider } from '../../platform/logging/appLogger';
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
 * @param options.emailSender Receives the identity emails; without one the routes that send email answer 503.
 * @param options.authRedirectUrls The addresses a link in an email may lead to.
 */
export async function startIdentityApp(options: { emailSender?: EmailSender; authRedirectUrls?: readonly string[] } = {}): Promise<NestFastifyApplication> {
  @Global()
  @Module({
    providers: [{ provide: RateLimiter, useValue: { check: () => Promise.resolve({ allowed: true, retryAfterSeconds: 0 }) } }],
    exports: [RateLimiter],
  })
  class OpenRateLimitModule {}

  @Global()
  @Module({ providers: [appLoggerProvider], exports: [APP_LOGGER] })
  class LoggerModule {}

  const config = testConfig({ databaseUrl: API_DATABASE_URL ?? KC_DATABASE_URL ?? '', authIssuer: OWN_ISSUER, authSigningKeys: await signingKeySetJson('test-key'), authRedirectUrls: options.authRedirectUrls ?? [] });
  @Module({ imports: [ApiConfigModule.forRoot(config), LoggerModule, DatabaseModule, IdentityModule, OpenRateLimitModule, BackgroundModule, IdentityRoutesModule.forRoot({ emailSender: options.emailSender }), SessionModule] })
  class IdentityTestModule {}
  return createApp(IdentityTestModule, config);
}
