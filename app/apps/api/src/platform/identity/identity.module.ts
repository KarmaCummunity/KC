import { Global, Module } from '@nestjs/common';
import { createRemoteJWKSet } from 'jose';
import type { ApiConfig } from '../config/apiConfig';
import { API_CONFIG } from '../config/apiConfig.module';
import { ACCESS_TOKEN_ISSUER, type AccessTokenIssuer, createAccessTokenIssuer } from './accessTokenIssuer';
import { ACCESS_TOKEN_VERIFIER, type AccessTokenVerifier, createAccessTokenVerifier } from './accessTokenVerifier';
import type { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.tokens';
import { KeySetController } from './keySet.controller';
import { withSessionCheck } from './sessionCheckedVerifier';
import { createSessionLiveness, SESSION_LIVENESS, type SessionLiveness } from './sessionLiveness';
import { loadSigningKeys, SIGNING_KEYS, type SigningKeySet } from './signingKeys';

/**
 * The verifier of an API that accepts another issuer's tokens. The issuer's
 * keys are fetched on the first token and cached; an unknown key id triggers
 * one refetch (rate limited), which is how a key rotation there is picked up.
 */
function createRemoteVerifier(config: ApiConfig): AccessTokenVerifier {
  const keys = createRemoteJWKSet(new URL(`${config.authIssuer}/.well-known/jwks.json`));
  return createAccessTokenVerifier(keys, config.authIssuer);
}

/** An API that issues tokens was started without the database its sessions are kept in. */
export class IssuerWithoutDatabaseError extends Error {
  constructor() {
    super('an API that signs access tokens needs the database module: a token is only accepted while its session is live');
    this.name = 'IssuerWithoutDatabaseError';
  }
}

/**
 * Who a token proves, and (ADR-013) the tokens themselves. With signing
 * keys configured this API is the issuer: it signs with its first key,
 * verifies against its own key set without a network call, accepts a token
 * only while its session is live, and publishes the key set. Without them
 * it accepts the tokens of the configured issuer. A key set that cannot be
 * used stops the process at start.
 */
@Global()
@Module({
  controllers: [KeySetController],
  providers: [
    { provide: SIGNING_KEYS, inject: [API_CONFIG], useFactory: (config: ApiConfig): Promise<SigningKeySet | null> => (config.authSigningKeys ? loadSigningKeys(config.authSigningKeys) : Promise.resolve(null)) },
    {
      provide: SESSION_LIVENESS,
      inject: [SIGNING_KEYS, { token: DATABASE_POOL, optional: true }],
      useFactory: (keys: SigningKeySet | null, pool?: Pool): SessionLiveness | null => {
        if (!keys) return null;
        if (!pool) throw new IssuerWithoutDatabaseError();
        return createSessionLiveness(pool);
      },
    },
    {
      provide: ACCESS_TOKEN_VERIFIER,
      inject: [API_CONFIG, SIGNING_KEYS, SESSION_LIVENESS],
      useFactory: (config: ApiConfig, keys: SigningKeySet | null, sessions: SessionLiveness | null): AccessTokenVerifier =>
        keys && sessions ? withSessionCheck(createAccessTokenVerifier(keys.verificationKeys, config.authIssuer), sessions) : createRemoteVerifier(config),
    },
    {
      provide: ACCESS_TOKEN_ISSUER,
      inject: [API_CONFIG, SIGNING_KEYS],
      useFactory: (config: ApiConfig, keys: SigningKeySet | null): AccessTokenIssuer | null => (keys ? createAccessTokenIssuer(keys, config.authIssuer) : null),
    },
  ],
  exports: [ACCESS_TOKEN_VERIFIER, ACCESS_TOKEN_ISSUER, SIGNING_KEYS],
})
export class IdentityModule {}
