import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { createApp } from '../createApp';
import { testConfig } from './support/testConfig';

const { DATABASE_URL, REDIS_URL } = process.env;

/**
 * Runs only when both variables point at live services (a local Postgres and
 * Redis, or the CI service containers); skipped everywhere else.
 */
describe('AppModule with live dependencies', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const config = testConfig({ databaseUrl: DATABASE_URL ?? '', redisUrl: REDIS_URL ?? '' });
    app = await createApp(AppModule.forRoot(config), config);
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports ready through the real pool and client', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready', checks: { database: 'up', redis: 'up' } });
  });
});
