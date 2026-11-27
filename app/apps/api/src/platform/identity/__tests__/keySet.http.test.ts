import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createLocalJWKSet, type JWK } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../createApp';
import { testConfig } from '../../../__tests__/support/testConfig';
import { ApiConfigModule } from '../../config/apiConfig.module';
import { DATABASE_POOL } from '../../database/database.tokens';
import { ACCESS_TOKEN_ISSUER, type AccessTokenIssuer } from '../accessTokenIssuer';
import { ACCESS_TOKEN_VERIFIER, type AccessTokenVerifier, createAccessTokenVerifier } from '../accessTokenVerifier';
import { IdentityModule } from '../identity.module';
import { signingKeySetJson } from './signingKeyFixtures';

const ISSUER = 'https://api.kc.test/v1/auth';
const MEMBER = { userId: '11111111-1111-4111-8111-111111111111', sessionId: '99999999-9999-4999-8999-999999999999' };

describe('GET /v1/auth/.well-known/jwks.json', () => {
  let app: NestFastifyApplication | undefined;

  /** An app with the identity module alone, as an issuer when `authSigningKeys` is given. */
  async function start(authSigningKeys: string | null, withDatabase = true): Promise<NestFastifyApplication> {
    const config = testConfig({ authIssuer: ISSUER, authSigningKeys });
    // An issuer keeps its sessions in the database; these cases never ask it, so a pool nobody can connect to stands in.
    @Global()
    @Module({ providers: [{ provide: DATABASE_POOL, useValue: { connect: () => Promise.reject(new Error('no database in this test')) } }], exports: [DATABASE_POOL] })
    class NoDatabaseModule {}
    @Module({ imports: [ApiConfigModule.forRoot(config), ...(withDatabase ? [NoDatabaseModule] : []), IdentityModule] })
    class TestModule {}
    app = await createApp(TestModule, config);
    return app;
  }

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('publishes the keys a token of this API verifies against, as any other service would fetch them', async () => {
    const started = await start(await signingKeySetJson('k1', 'k0'));
    const { token } = await started.get<AccessTokenIssuer>(ACCESS_TOKEN_ISSUER).issue(MEMBER);

    const response = await started.inject({ method: 'GET', url: '/v1/auth/.well-known/jwks.json' });
    const published = response.json<{ keys: JWK[] }>();

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=300');
    expect(published.keys.map((key) => key.kid)).toEqual(['k1', 'k0']);
    expect(response.body).not.toContain('"d"');
    // A verifier that knows nothing but the published set accepts the token.
    await expect(createAccessTokenVerifier(createLocalJWKSet(published), ISSUER).verify(token)).resolves.toMatchObject({ userId: MEMBER.userId });
    // And so does the API's own, which never fetches it.
    // The API's own verifier needs no fetch for the signature, and goes on to ask the database about the session.
    await expect(started.get<AccessTokenVerifier>(ACCESS_TOKEN_VERIFIER).verify(token)).rejects.toThrow('no database in this test');
  });

  it('does not start as an issuer without the database its sessions are kept in', async () => {
    await expect(start(await signingKeySetJson('k1'), false)).rejects.toThrow('needs the database module');
  });

  it('answers 404 on an API that accepts another issuer\'s tokens, and that API issues none', async () => {
    const started = await start(null);

    expect((await started.inject({ method: 'GET', url: '/v1/auth/.well-known/jwks.json' })).statusCode).toBe(404);
    expect(started.get<AccessTokenIssuer | null>(ACCESS_TOKEN_ISSUER)).toBeNull();
  });

  it('does not start with signing keys that cannot be used', async () => {
    await expect(start('{"keys":[{"kty":"EC"}]}')).rejects.toThrow('Invalid signing keys');
  });
});
