import { Controller, Get, Header, Inject } from '@nestjs/common';
import type { JWK } from 'jose';
import { ApiError } from '../errors/ApiError';
import { SIGNING_KEYS, type SigningKeySet } from './signingKeys';

/** Body of the published key set, in the standard JWK Set form. */
export interface KeySetBody {
  readonly keys: readonly JWK[];
}

/**
 * The public keys this API's access tokens verify against (ADR-013 section
 * 2), at the address every verifier derives from the issuer:
 * `<issuer>/.well-known/jwks.json`. Public by nature; private halves are
 * never part of what `SigningKeySet` publishes.
 */
@Controller('auth')
export class KeySetController {
  constructor(@Inject(SIGNING_KEYS) private readonly keys: SigningKeySet | null) {}

  /** @throws ApiError `404 not_found` on an API that issues no tokens. */
  @Get('.well-known/jwks.json')
  // Short enough that a rotated-in key is seen within minutes, long enough that verifiers do not ask per token.
  @Header('cache-control', 'public, max-age=300')
  keySet(): KeySetBody {
    if (!this.keys) throw new ApiError('not_found', 404, 'this API issues no tokens');
    return { keys: this.keys.publicKeys };
  }
}
