import { Writable } from 'node:stream';
import fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { loggerOptions, pathOnly } from '../loggerOptions';

/** A server that logs with the API's options into memory, and the lines it wrote. */
function loggingServer() {
  const lines: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      for (const line of chunk.toString().split('\n').filter(Boolean)) lines.push(JSON.parse(line) as Record<string, unknown>);
      done();
    },
  });
  const options = loggerOptions({ environment: 'production' });
  const server = fastify({ logger: options === false ? false : { ...options, stream } });
  server.get('/v1/webhooks/provider', async (request) => {
    request.log.warn('slow provider');
    request.log.error({ err: new Error('boom') }, 'provider failed');
    return { ok: true };
  });
  return { server, lines };
}

describe('loggerOptions', () => {
  it('is silent in tests and writes everywhere else', () => {
    expect(loggerOptions({ environment: 'test' })).toBe(false);
    expect(loggerOptions({ environment: 'development' })).not.toBe(false);
  });

  it('writes each line with the severity and message fields the cloud log viewer reads', async () => {
    const { server, lines } = loggingServer();

    await server.inject({ method: 'GET', url: '/v1/webhooks/provider' });

    const bySeverity = (severity: string) => lines.filter((line) => line.severity === severity);
    expect(bySeverity('WARNING')).toEqual([expect.objectContaining({ message: 'slow provider', level: 40 })]);
    expect(bySeverity('ERROR')).toEqual([expect.objectContaining({ message: 'provider failed', level: 50, err: expect.objectContaining({ message: 'boom' }) })]);
    expect(bySeverity('INFO').map((line) => line.message)).toEqual(['incoming request', 'request completed']);
    expect(lines.every((line) => !('msg' in line))).toBe(true);
  });

  it('logs the path of a request and never its query string', async () => {
    const { server, lines } = loggingServer();

    await server.inject({ method: 'GET', url: '/v1/webhooks/provider?hub.verify_token=not-for-the-log&grant=signed-address' });

    const incoming = lines.find((line) => line.message === 'incoming request');
    expect(incoming?.req).toMatchObject({ method: 'GET', url: '/v1/webhooks/provider' });
    expect(JSON.stringify(lines)).not.toContain('not-for-the-log');
    expect(JSON.stringify(lines)).not.toContain('signed-address');
  });
});

describe('pathOnly', () => {
  it.each([
    ['/v1/ports', '/v1/ports'],
    ['/v1/storage/local/read?grant=abc', '/v1/storage/local/read'],
    ['/?a=1?b=2', '/'],
    ['', ''],
    [undefined, ''],
  ])('reduces %j to %j', (url, path) => {
    expect(pathOnly(url)).toBe(path);
  });
});
