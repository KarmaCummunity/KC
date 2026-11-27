import { Global, Module } from '@nestjs/common';
import { createRemoteJWKSet } from 'jose';
import type { ApiConfig } from '../config/apiConfig';
import { API_CONFIG } from '../config/apiConfig.module';
import { ACCESS_TOKEN_VERIFIER, type AccessTokenVerifier, createAccessTokenVerifier } from './accessTokenVerifier';

/**
 * Verifier backed by the issuer's published key set. Keys are fetched on the
 * first token and cached; an unknown key id triggers one refetch (rate
 * limited), which is how a key rotation at the issuer is picked up.
 */
function createRemoteVerifier(config: ApiConfig): AccessTokenVerifier {
  const keys = createRemoteJWKSet(new URL(`${config.authIssuer}/.well-known/jwks.json`));
  return createAccessTokenVerifier(keys, config.authIssuer);
}

@Global()
@Module({
  providers: [{ provide: ACCESS_TOKEN_VERIFIER, inject: [API_CONFIG], useFactory: createRemoteVerifier }],
  exports: [ACCESS_TOKEN_VERIFIER],
})
export class IdentityModule {}
