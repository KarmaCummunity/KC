import 'reflect-metadata';
import { Global, Injectable, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../createApp';
import { testConfig } from '../../../__tests__/support/testConfig';
import { ApiConfigModule } from '../../config/apiConfig.module';
import { APP_LOGGER, appLoggerProvider } from '../../logging/appLogger';
import { JobsModule } from '../jobs.module';
import { batchLimit, type JobReport, type ScheduledJob } from '../scheduledJob';

const TOKEN = 't'.repeat(32);
/** What the jobs were started with, in order. */
const runs: Array<{ job: string; input: Readonly<Record<string, unknown>> }> = [];

@Injectable()
class CountingJob implements ScheduledJob {
  readonly name = 'count-things';
  run(input: Readonly<Record<string, unknown>>): Promise<JobReport> {
    runs.push({ job: this.name, input });
    return Promise.resolve({ counted: 3 });
  }
}

@Injectable()
class FailingJob implements ScheduledJob {
  readonly name = 'always-fails';
  run(): Promise<JobReport> {
    return Promise.reject(new Error('connection string postgres://secret'));
  }
}

@Injectable()
class SameNameJob extends CountingJob {}

@Global()
@Module({ providers: [appLoggerProvider], exports: [APP_LOGGER] })
class LoggerModule {}

describe('POST /v1/jobs/:name', () => {
  let app: NestFastifyApplication | undefined;

  /** An app that runs `jobs`, with the jobs token configured unless `jobsToken` is null. */
  async function start(jobsToken: string | null = TOKEN, jobs: Array<new () => ScheduledJob> = [CountingJob, FailingJob]) {
    const config = testConfig({ jobsToken });
    @Module({ imports: [ApiConfigModule.forRoot(config), LoggerModule, JobsModule.forRoot({ jobs, providers: [] })] })
    class TestModule {}
    app = await createApp(TestModule, config);
    runs.length = 0;
    const started = app;
    return (name: string, options: { token?: string | null; payload?: unknown } = {}) =>
      started.inject({
        method: 'POST',
        url: `/v1/jobs/${name}`,
        payload: (options.payload ?? {}) as object,
        headers: options.token === null ? {} : { authorization: `Bearer ${options.token ?? TOKEN}` },
      });
  }

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('runs the named job with the scheduler\'s options and answers its counters', async () => {
    const call = await start();

    const response = await call('count-things', { payload: { limit: 5 } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, counted: 3 });
    expect(runs).toEqual([{ job: 'count-things', input: { limit: 5 } }]);
  });

  it('gives a job an empty object when the body is not one', async () => {
    const call = await start();

    await call('count-things', { payload: [1, 2] });

    expect(runs).toEqual([{ job: 'count-things', input: {} }]);
  });

  it('refuses a call without the jobs token, with a wrong one, or with the token not sent as a bearer', async () => {
    const call = await start();
    const started = app as NestFastifyApplication;

    const missing = await call('count-things', { token: null });
    const wrong = await call('count-things', { token: 'w'.repeat(32) });
    const bare = await started.inject({ method: 'POST', url: '/v1/jobs/count-things', payload: {}, headers: { authorization: TOKEN } });

    expect([missing.statusCode, wrong.statusCode, bare.statusCode]).toEqual([401, 401, 401]);
    expect(missing.json()).toEqual({ ok: false, error: 'unauthenticated' });
    expect(runs).toEqual([]);
  });

  it('refuses every call when no jobs token is configured, even one with an empty bearer', async () => {
    const call = await start(null);

    const response = await call('count-things', { token: '' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ ok: false, error: 'not_configured' });
    expect(runs).toEqual([]);
  });

  it('answers 404 for a name no job has, only to a caller with the token', async () => {
    const call = await start();

    expect((await call('no-such-job')).statusCode).toBe(404);
    expect((await call('no-such-job', { token: null })).statusCode).toBe(401);
  });

  it('answers 500 for a job that failed, without the cause', async () => {
    const call = await start();

    const response = await call('always-fails');

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ ok: false, error: 'internal' });
    expect(response.body).not.toContain('secret');
  });

  it('refuses to start with two jobs of one name', async () => {
    await expect(start(TOKEN, [CountingJob, SameNameJob])).rejects.toThrow('scheduled job "count-things" is registered twice');
  });
});

describe('batchLimit', () => {
  it('keeps a requested size within the allowed range and falls back when none is usable', () => {
    expect([5, 500, 2.9, undefined, 'many', 0, -3].map((asked) => batchLimit(asked, 20, 50))).toEqual([5, 50, 2, 20, 20, 20, 20]);
  });
});
