import { Body, Controller, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiConfig } from '../config/apiConfig';
import { API_CONFIG } from '../config/apiConfig.module';
import { APP_LOGGER, type AppLogger } from '../logging/appLogger';
import { equalInConstantTime } from '../security/constantTime';
import { SCHEDULED_JOBS, type ScheduledJob } from './scheduledJob';

/** Two scheduled jobs claim the same name. */
export class DuplicateScheduledJobError extends Error {
  constructor(name: string) {
    super(`scheduled job "${name}" is registered twice`);
    this.name = 'DuplicateScheduledJobError';
  }
}

const BEARER = 'Bearer ';

/**
 * `POST /v1/jobs/<name>`: how a scheduler starts a job. No member is involved,
 * so the only credential is the jobs token (`KC_JOBS_TOKEN`) as a bearer
 * token; without a configured token every call is refused. The answers are for
 * a machine: `{ ok, ... }` with the run's counters, never a cause of failure.
 */
@Controller('jobs')
export class JobsController {
  private readonly jobs: ReadonlyMap<string, ScheduledJob>;

  constructor(
    @Inject(SCHEDULED_JOBS) jobs: readonly ScheduledJob[],
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {
    const byName = new Map<string, ScheduledJob>();
    for (const job of jobs) {
      // A second registration would silently replace the first; fail at start-up instead.
      if (byName.has(job.name)) throw new DuplicateScheduledJobError(job.name);
      byName.set(job.name, job);
    }
    this.jobs = byName;
  }

  @Post(':name')
  @HttpCode(200)
  async run(@Param('name') name: string, @Body() body: unknown, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<unknown> {
    const refuse = (status: number, error: string) => {
      void reply.status(status);
      return { ok: false, error };
    };
    const token = this.config.jobsToken;
    if (!token) return refuse(503, 'not_configured');
    const authorization = request.headers.authorization ?? '';
    const given = authorization.startsWith(BEARER) ? authorization.slice(BEARER.length) : '';
    if (!equalInConstantTime(given, token)) return refuse(401, 'unauthenticated');

    const job = this.jobs.get(name);
    if (!job) return refuse(404, 'unknown_job');
    const input = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    const startedAt = Date.now();
    try {
      const report = await job.run(input);
      this.logger.info({ job: name, durationMs: Date.now() - startedAt, ...report }, 'scheduled job finished');
      return { ok: true, ...report };
    } catch (error) {
      this.logger.error({ err: error, job: name, durationMs: Date.now() - startedAt }, 'scheduled job failed');
      return refuse(500, 'internal');
    }
  }
}
