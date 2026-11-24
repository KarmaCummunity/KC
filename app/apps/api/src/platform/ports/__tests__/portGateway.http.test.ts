import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestIssuer, USER_A } from '../../../__tests__/support/testTokens';
import { DuplicatePortError, indexPorts } from '../portGateway.module';
import type { PortManifest } from '@kc/infrastructure-api';
import { UnknownRolloutPortError } from '../portRollout';
import { callShelf, createShelfApp, resetShelf, shelf } from './shelfPort';

describe('port gateway over HTTP', () => {
  let app: NestFastifyApplication;
  let issuer: TestIssuer;
  let token: string;

  beforeAll(async () => {
    ({ app, issuer } = await createShelfApp());
  });

  beforeEach(async () => {
    token = await issuer.sign(USER_A);
    resetShelf();
  });

  afterAll(async () => {
    await app.close();
  });

  const call = (path: string, args: unknown, authorization: string | null = `Bearer ${token}`) =>
    callShelf(app, path, args, authorization);

  it('runs the method with the arguments and returns its result', async () => {
    const response = await call('shelf/echo', ['a', 2, 'c']);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ result: { first: 'a', second: 2, third: 'c' } });
  });

  it('keeps a skipped argument skipped and lets defaults apply to omitted ones', async () => {
    const response = await call('shelf/echo', ['a', { $undefined: true }]);

    expect(response.json()).toEqual({ result: { first: 'a', second: 'undefined', third: 'default' } });
  });

  it('answers a method that returns nothing with an empty object', async () => {
    expect((await call('shelf/nothing', [])).json()).toEqual({});
  });

  it('runs a member method as the caller the token proves', async () => {
    expect((await call('shelf/whoAmI', [])).json()).toEqual({ result: USER_A });
  });

  it('runs a public method for a signed-out visitor, with no caller', async () => {
    const response = await call('shelf/whoAmI', [], null);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ result: null });
  });

  it('refuses a member method without a token, and any method with a bad token', async () => {
    expect((await call('shelf/echo', ['a'], null)).statusCode).toBe(401);
    expect((await call('shelf/echo', ['a'], 'Bearer not.a.token')).statusCode).toBe(401);
    // A broken session is never downgraded to "signed out", even where visitors are welcome.
    expect((await call('shelf/whoAmI', [], 'Bearer not.a.token')).statusCode).toBe(401);
    expect((await call('shelf/whoAmI', [], 'Basic abc')).statusCode).toBe(401);
  });

  it.each(['nope/echo', 'shelf/nope', 'shelf/secret', 'shelf/constructor', 'shelf/toString', 'shelf/__proto__', 'shelf/hasOwnProperty'])(
    'answers 404 for %s',
    async (path) => {
      const response = await call(path, []);

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('port_method_not_found');
    },
  );

  it('answers 501 for a method the API does not carry yet', async () => {
    expect((await call('shelf/upload', [])).json().error.code).toBe('port_method_not_served');
    expect((await call('shelf/needsStorage', [])).statusCode).toBe(501);
  });

  it.each([
    ['no args key', {}],
    ['args that are not an array', { args: 'a' }],
    ['too many args', { args: Array.from({ length: 17 }, () => 1) }],
  ])('answers 400 for a body with %s', async (_case, payload) => {
    const response = await app.inject({ method: 'POST', url: '/v1/ports/shelf/echo', payload, headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(400);
  });

  it('sends a typed port error to the app as itself, without its cause', async () => {
    const response = await call('shelf/refuse', []);

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toMatchObject({
      code: 'port_error',
      detail: { port: { type: 'FollowError', message: 'wait', fields: { code: 'cooldown_active', cooldownUntil: '2026-12-01T00:00:00Z' } } },
    });
    expect(response.body).not.toContain('pg detail');
  });

  it('hides an unexpected failure behind internal_error', async () => {
    const response = await call('shelf/crash', []);

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('internal_error');
    expect(response.body).not.toContain('hunter2');
  });

  it('refuses two ports with one name at start-up', () => {
    expect(() => indexPorts([shelf, shelf])).toThrow(DuplicatePortError);
    expect(indexPorts([shelf]).get('shelf')).toBe(shelf);
  });

  it('runs a catalog method whose arguments match its port interface', async () => {
    expect((await call('savedPosts/savePost', ['p1'])).json()).toEqual({ result: 'saved p1' });
    expect((await call('savedPosts/listSavedPosts', [20])).json()).toEqual({ result: { limit: 20, cursor: null } });
    expect((await call('savedPosts/listSavedPosts', [20, 'c1'])).json()).toEqual({ result: { limit: 20, cursor: 'c1' } });
  });

  it.each([
    ['a number where the interface says string', 'savedPosts/savePost', [5], 'postId: expected string'],
    ['an object where the interface says string', 'savedPosts/savePost', [{ $ne: null }], 'postId: expected string'],
    ['a missing required argument', 'savedPosts/savePost', [], 'postId: required'],
    ['a string where the interface says number', 'savedPosts/listSavedPosts', ['20'], 'limit: expected number'],
    ['more arguments than the method takes', 'savedPosts/savePost', ['p1', 'extra'], 'expected at most 1 arguments, got 2'],
  ])('answers 400 to %s, without running the method', async (_case, path, args, problem) => {
    const response = await call(path, args);

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({ code: 'invalid_arguments', detail: { problem } });
  });

  it('lists what a definition serves in the manifest and leaves out what it does not', async () => {
    // No token: the manifest is public, listing is not access.
    const response = await app.inject({ method: 'GET', url: '/v1/ports' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ports: {
        shelf: ['echo', 'whoAmI', 'nothing', 'refuse', 'crash', 'needsStorage', 'counted', 'countedNothing', 'countedRefusal'],
        savedPosts: ['savePost', 'listSavedPosts'],
        legalDocument: ['getCurrentContent', 'acceptVersion'],
      },
    });
  });
});

describe('port gateway manifest with rollout rules', () => {
  it('publishes each port\'s own rule, the default for the others, and nothing for a port neither covers', async () => {
    const { app } = await createShelfApp({ portRollout: { '*': { percent: 0 }, savedPosts: { percent: 25, minAppVersion: '1.6.0' } } });

    const manifest = (await app.inject({ method: 'GET', url: '/v1/ports' })).json<PortManifest>();
    await app.close();

    expect(manifest.rollout).toEqual({ shelf: { percent: 0 }, savedPosts: { percent: 25, minAppVersion: '1.6.0' }, legalDocument: { percent: 0 } });
    // The rules narrow who is routed here; what is served is unchanged.
    expect(Object.keys(manifest.ports)).toEqual(['shelf', 'savedPosts', 'legalDocument']);
  });

  it('refuses to start with a rule for a port it does not have', async () => {
    await expect(createShelfApp({ portRollout: { savedPost: { percent: 10 } } })).rejects.toBeInstanceOf(UnknownRolloutPortError);
  });
});

