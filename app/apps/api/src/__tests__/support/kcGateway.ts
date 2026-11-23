import { Global, Module } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../createApp';
import { HOSTED_PORTS } from '../../modules/hostedAdapters/hostedPorts';
import { type HostedFunctionOverrides, hostedFunctionSet } from '../../modules/hostedFunctions/hostedFunctionSet';
import { IdentityVerificationModule } from '../../modules/identityVerification/identityVerification.module';
import type { IdentityProvider } from '../../modules/identityVerification/identityProvider';
import type { ApiConfig } from '../../platform/config/apiConfig';
import { ApiConfigModule } from '../../platform/config/apiConfig.module';
import { DatabaseModule } from '../../platform/database/database.module';
import { ACCESS_TOKEN_VERIFIER } from '../../platform/identity/accessTokenVerifier';
import { PortClientsModule } from '../../platform/ports/portClients.module';
import { PortGatewayModule } from '../../platform/ports/portGateway.module';
import { VisitorCache } from '../../platform/ports/visitorCache';
import { RateLimiter } from '../../platform/rateLimit/rateLimiter';
import { KC_DATABASE_URL } from './kcDatabase';
import { testConfig } from './testConfig';
import { createTestIssuer, type TestIssuer } from './testTokens';

/** The real gateway with every hosted port, on the KC test schema. */
export interface KcGateway {
  readonly app: NestFastifyApplication;
  /** Signs the access tokens the gateway accepts. */
  readonly issuer: TestIssuer;
  /** Opens a local port on first use and returns the base URL, for tests that go through `fetch`. */
  listen(): Promise<string>;
}

/**
 * Starts the gateway as production wires it, except for what a test must not
 * depend on: tokens are signed locally, the rate limiter always allows, and
 * the visitor cache always misses (these suites check what the database
 * answers, not Redis).
 * @param overrides Outbound calls of the hosted functions, the identity provider, and configuration fields.
 */
export async function startKcGateway(
  overrides: { functions?: HostedFunctionOverrides; identityProvider?: IdentityProvider; config?: Partial<ApiConfig> } = {},
): Promise<KcGateway> {
  const issuer = await createTestIssuer();

  @Global()
  @Module({
    providers: [
      { provide: ACCESS_TOKEN_VERIFIER, useValue: issuer.verifier },
      { provide: RateLimiter, useValue: { check: () => Promise.resolve({ allowed: true, retryAfterSeconds: 0 }) } },
      { provide: VisitorCache, useValue: { read: () => Promise.resolve({ found: false }), write: () => Promise.resolve() } },
    ],
    exports: [ACCESS_TOKEN_VERIFIER, RateLimiter, VisitorCache],
  })
  class LocalIdentityModule {}

  const config = testConfig({ databaseUrl: KC_DATABASE_URL ?? '', ...overrides.config });
  @Module({
    imports: [
      ApiConfigModule.forRoot(config),
      DatabaseModule,
      LocalIdentityModule,
      PortClientsModule,
      IdentityVerificationModule.forRoot({ provider: overrides.identityProvider }),
      PortGatewayModule.forRoot(HOSTED_PORTS, hostedFunctionSet(overrides.functions)),
    ],
  })
  class GatewayModule {}

  const app = await createApp(GatewayModule, config);
  return {
    app,
    issuer,
    async listen() {
      if (!app.getHttpServer().address()) await app.listen(0, '127.0.0.1');
      return `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    },
  };
}
