import { Controller, Get, Inject } from '@nestjs/common';
import type { ApiConfig, ApiEnvironment } from '../config/apiConfig';
import { API_CONFIG } from '../config/apiConfig.module';

/** Body of `GET /health`. */
export interface HealthReport {
  readonly status: 'ok';
  readonly version: string;
  readonly environment: ApiEnvironment;
}

/**
 * Liveness: the process is up and serving HTTP. It checks no dependency on
 * purpose, so a database outage does not make the platform restart healthy
 * API instances. The deploy smoke test reads `version` to confirm the release.
 */
@Controller('health')
export class HealthController {
  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  @Get()
  check(): HealthReport {
    return { status: 'ok', version: this.config.version, environment: this.config.environment };
  }
}
