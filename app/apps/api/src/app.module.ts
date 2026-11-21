import { type DynamicModule, Module } from '@nestjs/common';
import { HOSTED_PORTS } from './modules/hostedAdapters/hostedPorts';
import { SessionModule } from './modules/session/session.module';
import type { ApiConfig } from './platform/config/apiConfig';
import { ApiConfigModule } from './platform/config/apiConfig.module';
import { DatabaseModule, DatabaseProbe } from './platform/database/database.module';
import { HealthModule } from './platform/health/health.module';
import { IdentityModule } from './platform/identity/identity.module';
import { PortGatewayModule } from './platform/ports/portGateway.module';
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
        HealthModule.withProbes([DatabaseProbe, RedisProbe]),
        SessionModule,
        PortGatewayModule.forRoot(HOSTED_PORTS),
      ],
    };
  }
}
