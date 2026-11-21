import { type DynamicModule, Module } from '@nestjs/common';
import type { ApiConfig } from './platform/config/apiConfig';
import { ApiConfigModule } from './platform/config/apiConfig.module';
import { HealthModule } from './platform/health/health.module';

/**
 * Root module. Each bounded context is added here as its own module
 * (`src/modules/<context>`), see ADR-009.
 */
@Module({})
export class AppModule {
  static forRoot(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [ApiConfigModule.forRoot(config), HealthModule],
    };
  }
}
