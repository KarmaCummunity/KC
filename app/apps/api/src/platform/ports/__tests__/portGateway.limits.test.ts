import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestIssuer, USER_A } from '../../../__tests__/support/testTokens';
import { indexPorts, VisitorCacheOnPrivateMethodError } from '../portGateway.module';
import { callShelf, createShelfApp, limiter, resetShelf, runs, shelf, visitorCache } from './shelfPort';

describe('port gateway: rate limit and visitor cache', () => {
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

  it('counts a member by user id and a visitor by address', async () => {
    await call('shelf/whoAmI', []);
    await call('shelf/whoAmI', [], null);

    expect(limiter.subjects).toEqual([`user:${USER_A}`, 'ip:127.0.0.1']);
  });

  it('answers 429 with the time to wait when the caller is over the limit, without running the method', async () => {
    limiter.blocked = true;

    const response = await call('shelf/crash', []);

    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe('too_many_requests');
    expect(response.headers['retry-after']).toBe('42');
  });

  it('does not count a call that was refused before it reached a method', async () => {
    await call('shelf/echo', ['a'], null);
    await call('shelf/nope', []);

    expect(limiter.subjects).toEqual([]);
  });

  it('answers visitors from the cache: one run serves every visitor who asks the same thing', async () => {
    const first = await call('shelf/counted', ['a'], null);
    const second = await call('shelf/counted', ['a'], null);
    const other = await call('shelf/counted', ['b'], null);

    expect([first.json(), second.json(), other.json()]).toEqual([{ result: 1 }, { result: 1 }, { result: 2 }]);
    expect(runs.counted).toBe(2);
    expect(visitorCache.lifetimes).toEqual([30, 30]);
  });

  it('never answers a member from the cache, and never stores a member\'s answer', async () => {
    await call('shelf/counted', ['a'], null);

    const asMember = await call('shelf/counted', ['a']);
    const asVisitorAgain = await call('shelf/counted', ['a'], null);

    expect(asMember.json()).toEqual({ result: 2 });
    expect(asVisitorAgain.json()).toEqual({ result: 1 });
    expect(visitorCache.entries.size).toBe(1);
  });

  it('caches a result of nothing as nothing, not as a miss', async () => {
    const first = await call('shelf/countedNothing', [], null);
    const second = await call('shelf/countedNothing', [], null);

    expect([first.json(), second.json()]).toEqual([{}, {}]);
    expect(runs.countedNothing).toBe(1);
  });

  it('does not cache a refusal', async () => {
    await call('shelf/countedRefusal', [], null);
    await call('shelf/countedRefusal', [], null);

    expect(runs.countedRefusal).toBe(2);
    expect(visitorCache.entries.size).toBe(0);
  });

  it('still counts a cached answer against the visitor\'s rate limit', async () => {
    await call('shelf/counted', ['a'], null);
    await call('shelf/counted', ['a'], null);

    expect(limiter.subjects).toEqual(['ip:127.0.0.1', 'ip:127.0.0.1']);
  });

  it('refuses at start-up a visitor cache on a method visitors cannot call', () => {
    const leaky = { ...shelf, name: 'leaky', visitorCacheSeconds: { echo: 30 } };

    expect(() => indexPorts([leaky])).toThrow(VisitorCacheOnPrivateMethodError);
  });
});
