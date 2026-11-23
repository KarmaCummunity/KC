import { type DynamicModule, Module } from '@nestjs/common';
import { BillingModule } from './modules/billing/billing.module';
import { HOSTED_PORTS } from './modules/hostedAdapters/hostedPorts';
import { hostedFunctionSet } from './modules/hostedFunctions/hostedFunctionSet';
import { IdentityVerificationModule } from './modules/identityVerification/identityVerification.module';
import { SessionModule } from './modules/session/session.module';
import type { ApiConfig } from './platform/config/apiConfig';
import { ApiConfigModule } from './platform/config/apiConfig.module';
import { DatabaseModule, DatabaseProbe } from './platform/database/database.module';
import { HealthModule } from './platform/health/health.module';
import { IdentityModule } from './platform/identity/identity.module';
import { PortClientsModule } from './platform/ports/portClients.module';
import { PortGatewayModule } from './platform/ports/portGateway.module';
import { VisitorCacheModule } from './platform/ports/visitorCache';
import { RateLimitModule } from './platform/rateLimit/rateLimiter';
import { RedisModule, RedisProbe } from './platform/redis/redis.module';

/**
 * Root module. Each bounded context is added here as its own module
 * (`src/modules/<context>`), see ADR-009.
 */
@Module({})
export class AppModule {
  static forRoot(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ApiConfigModule.forRoot(config),
        DatabaseModule,
        RedisModule,
        IdentityModule,
        RateLimitModule,
        VisitorCacheModule,
        HealthModule.withProbes([DatabaseProbe, RedisProbe]),
        SessionModule,
        PortClientsModule,
        IdentityVerificationModule.forRoot(),
        BillingModule,
        PortGatewayModule.forRoot(HOSTED_PORTS, hostedFunctionSet()),
      ],
    };
  }
}
