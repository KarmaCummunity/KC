import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { createApp } from '../createApp';
import { DATABASE_POOL } from '../platform/database/database.module';
import { testConfig } from './support/testConfig';

/**
 * The real module graph (real pool, real Redis client) pointed at addresses
 * nothing listens on: proves the wiring resolves and that an outage of both
 * dependencies is survivable.
 */
describe('AppModule with unreachable dependencies', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const config = testConfig();
    app = await createApp(AppModule.forRoot(config), config);
  });

  afterAll(async () => {
    await app.close();
  });

  it('starts and stays alive without its dependencies', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
  });

  it('reports both dependencies down', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready', checks: { database: 'down', redis: 'down' } });
  });

  it('survives an error on an idle database connection', () => {
    const pool = app.get<Pool>(DATABASE_POOL);

    // An EventEmitter throws on `error` when nobody listens; the pool must listen.
    expect(() => pool.emit('error', new Error('server closed the connection'))).not.toThrow();
  });
});
