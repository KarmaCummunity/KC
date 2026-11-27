import 'reflect-metadata';
import { Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../createApp';
import { ApiConfigModule } from '../platform/config/apiConfig.module';
import { HealthModule } from '../platform/health/health.module';
import { testConfig } from './support/testConfig';

const WEB_APP = 'https://app.kc.test';

async function appWith(allowedOrigins: string[], trustedProxyHops = 0): Promise<NestFastifyApplication> {
  const config = testConfig({ allowedOrigins, trustedProxyHops });

  @Module({ imports: [ApiConfigModule.forRoot(config), HealthModule.withProbes([])] })
  class TestModule {}

  return createApp(TestModule, config);
}

describe('browser access (CORS)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await appWith([WEB_APP]);
  });

  afterAll(async () => {
    await app.close();
  });

  const preflight = (origin: string) =>
    app.inject({
      method: 'OPTIONS',
      url: '/v1/ports/user/follow',
      headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' },
    });

  it('lets the configured web origin call the API with a token', async () => {
    const response = await preflight(WEB_APP);

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(WEB_APP);
    expect(response.headers['access-control-allow-headers']).toContain('authorization');
    expect(response.headers['access-control-allow-methods']).toContain('POST');
  });

  it('gives any other site no permission', async () => {
    const response = await preflight('https://evil.test');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('lets the web app read the request id and the retry delay', async () => {
    const response = await app.inject({ method: 'GET', url: '/health', headers: { origin: WEB_APP } });

    expect(response.headers['access-control-expose-headers']).toContain('x-request-id');
    expect(response.headers['access-control-expose-headers']).toContain('retry-after');
  });

  it('sends no CORS headers at all when no origin is configured', async () => {
    const closed = await appWith([]);
    try {
      const response = await closed.inject({ method: 'GET', url: '/health', headers: { origin: WEB_APP } });

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await closed.close();
    }
  });
});
