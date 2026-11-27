import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiConfig, ApiEnvironment } from '../config/apiConfig';
import { API_CONFIG } from '../config/apiConfig.module';
import { DEPENDENCY_PROBES, type DependencyProbe } from './dependencyProbe';
import { checkDependencies, type DependencyStatus } from './readiness';

/** Body of `GET /health`. */
export interface HealthReport {
  readonly status: 'ok';
  readonly version: string;
  readonly environment: ApiEnvironment;
}

/** Body of `GET /health/ready`. */
export interface ReadinessBody {
  readonly status: 'ready' | 'not_ready';
  readonly checks: Readonly<Record<string, DependencyStatus>>;
}

/** Longest a dependency may take to answer a readiness probe. */
const PROBE_TIMEOUT_MS = 2000;

@Controller('health')
export class HealthController {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(DEPENDENCY_PROBES) private readonly probes: readonly DependencyProbe[],
  ) {}

  /**
   * Liveness: the process is up and serving HTTP. It checks no dependency on
   * purpose, so a database outage does not make the platform restart healthy
   * API instances. The deploy smoke test reads `version` to confirm the release.
   */
  @Get()
  check(): HealthReport {
    return { status: 'ok', version: this.config.version, environment: this.config.environment };
  }

  /**
   * Readiness: can this instance serve requests right now? `503` takes the
   * instance out of rotation without restarting it. The body says which
   * dependency is down and nothing else; the cause goes to the log.
   */
  @Get('ready')
  async ready(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<ReadinessBody> {
    const report = await checkDependencies(this.probes, PROBE_TIMEOUT_MS);
    for (const failure of report.failures) {
      request.log.warn({ dependency: failure.name, err: failure.cause }, 'dependency not ready');
    }
    reply.status(report.ready ? 200 : 503);
    return { status: report.ready ? 'ready' : 'not_ready', checks: report.checks };
  }
}
