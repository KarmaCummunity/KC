import { Global, Module } from '@nestjs/common';
import { createRemoteJWKSet } from 'jose';
import type { ApiConfig } from '../config/apiConfig';
import { API_CONFIG } from '../config/apiConfig.module';
import { ACCESS_TOKEN_ISSUER, type AccessTokenIssuer, createAccessTokenIssuer } from './accessTokenIssuer';
import { ACCESS_TOKEN_VERIFIER, type AccessTokenVerifier, createAccessTokenVerifier } from './accessTokenVerifier';
import { KeySetController } from './keySet.controller';
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

/**
 * Who a token proves, and (ADR-013) the tokens themselves. With signing
 * keys configured this API is the issuer: it signs with its first key,
 * verifies against its own key set without a network call, and publishes
 * that set. Without them it accepts the tokens of the configured issuer.
 * A key set that cannot be used stops the process at start.
 */
@Global()
@Module({
  controllers: [KeySetController],
  providers: [
    { provide: SIGNING_KEYS, inject: [API_CONFIG], useFactory: (config: ApiConfig): Promise<SigningKeySet | null> => (config.authSigningKeys ? loadSigningKeys(config.authSigningKeys) : Promise.resolve(null)) },
    {
      provide: ACCESS_TOKEN_VERIFIER,
      inject: [API_CONFIG, SIGNING_KEYS],
      useFactory: (config: ApiConfig, keys: SigningKeySet | null): AccessTokenVerifier => (keys ? createAccessTokenVerifier(keys.verificationKeys, config.authIssuer) : createRemoteVerifier(config)),
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
