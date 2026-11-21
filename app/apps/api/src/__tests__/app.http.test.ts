import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { createApp } from '../createApp';
import type { ApiConfig } from '../platform/config/apiConfig';
import { ApiError } from '../platform/errors/ApiError';

const config: ApiConfig = { environment: 'test', host: '127.0.0.1', port: 0, version: '9.9.9' };

/** Routes that fail on purpose, to observe the error contract from outside. */
@Controller('probe')
class FailingProbeController {
  @Get('typed')
  typed(): never {
    throw new ApiError('probe_conflict', 409, 'log-only detail');
  }

  @Get('unexpected')
  unexpected(): never {
    throw new Error('database password is hunter2');
  }
}

@Module({ imports: [AppModule.forRoot(config)], controllers: [FailingProbeController] })
class ProbeModule {}

describe('API over HTTP', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApp(ProbeModule, config);
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers the health check with the version and environment', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: '9.9.9', environment: 'test' });
  });

  it('keeps the health check out of the versioned prefix', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/health' });

    expect(response.statusCode).toBe(404);
  });

  it('serves business routes under /v1 only', async () => {
    const versioned = await app.inject({ method: 'GET', url: '/v1/probe/typed' });
    const unversioned = await app.inject({ method: 'GET', url: '/probe/typed' });

    expect(versioned.statusCode).toBe(409);
    expect(unversioned.statusCode).toBe(404);
  });

  it('generates a request id and returns it in the header', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('echoes a well-formed caller request id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'caller-trace-0001' },
    });

    expect(response.headers['x-request-id']).toBe('caller-trace-0001');
  });

  it('maps a typed error to its status and code, with the request id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/probe/typed',
      headers: { 'x-request-id': 'caller-trace-0002' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: { code: 'probe_conflict', requestId: 'caller-trace-0002' } });
  });

  it('answers an unknown route with the same error shape', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/no-such-route' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'not_found', requestId: response.headers['x-request-id'] },
    });
  });

  it('hides the cause of an unexpected error', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/probe/unexpected' });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('internal_error');
    expect(response.body).not.toContain('hunter2');
    expect(response.body).not.toContain('stack');
  });
});
