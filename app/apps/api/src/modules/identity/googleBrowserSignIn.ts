import { randomBytes } from 'node:crypto';
import type { SessionResponse } from '@kc/infrastructure-api';
import { Inject, Injectable } from '@nestjs/common';
import { errors, jwtVerify, SignJWT } from 'jose';
import type { ApiConfig } from '../../platform/config/apiConfig';
import { API_CONFIG } from '../../platform/config/apiConfig.module';
import { IdentityDatabase } from '../../platform/database/identityDatabase';
import { ApiError } from '../../platform/errors/ApiError';
import { SIGNING_ALGORITHM, SIGNING_KEYS, type SigningKeySet } from '../../platform/identity/signingKeys';
import { APP_LOGGER, type AppLogger } from '../../platform/logging/appLogger';
import { issueSignInCode, redeemSignInCode } from './credentialStore';
import { PROVIDER_TOKEN_VERIFIERS, ProviderAccountService, type ProviderTokenVerifiers } from './providerAccountService';
import { InvalidProviderTokenError } from './providerTokens';
import { SessionService } from './sessionService';

/** Where a browser is sent to sign in at Google, and where Google's answer is exchanged for an ID token. */
export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Path of the route Google sends the browser back to, under the issuer's address; registered at Google as such. */
export const GOOGLE_CALLBACK_PATH = '/google/callback';

/** Injection token of the `GoogleCodeExchange`. */
export const GOOGLE_CODE_EXCHANGE = Symbol('GOOGLE_CODE_EXCHANGE');
/**
 * Exchanges the code Google handed the browser for the ID token; replaced in tests.
 * @returns The ID token, or null when Google refused the code.
 */
export type GoogleCodeExchange = (form: URLSearchParams) => Promise<string | null>;

/** The exchange against Google itself. */
export const exchangeAtGoogle: GoogleCodeExchange = async (form) => {
  const response = await fetch(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(10_000) });
  const body = (await response.json().catch(() => null)) as { id_token?: unknown } | null;
  return response.ok && typeof body?.id_token === 'string' ? body.id_token : null;
};

/** What a sign-in carries through the browser's trip to Google and back, signed so that nobody else can make or change it. */
interface SignInState {
  /** Where the app wants the browser to end up. */
  readonly r: string;
  /** The app instance's PKCE challenge. */
  readonly c: string;
  /** What Google must put in the ID token of this sign-in. */
  readonly n: string;
}

const STATE_AUDIENCE = 'kc-google-browser-sign-in';
/** The longest a member may take at Google's page. */
const STATE_SECONDS = 10 * 60;
/** SHA-256 in base64url is 43 characters; a verifier is 43 to 128 (RFC 7636). */
const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

const isText = (value: unknown, maxLength: number): value is string => typeof value === 'string' && value !== '' && value.length <= maxLength;

/**
 * Google sign-in through a browser redirect (ADR-013 section 3, D-33), for
 * an app that cannot show Google's native sheet. Three steps:
 *
 * 1. The app opens `authorize` with where it wants to end up and the SHA-256
 *    of a secret it keeps. The browser is sent on to Google.
 * 2. Google sends the browser to `callback`. The API exchanges Google's code
 *    for an ID token, finds or creates the member, and sends the browser to
 *    the app with a one-time code of its own.
 * 3. The app exchanges that code, with its secret, for a session.
 *
 * Nothing that signs anyone in passes through the browser's address bar
 * except the last code, which is useless without the app's secret.
 */
@Injectable()
export class GoogleBrowserSignIn {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(SIGNING_KEYS) private readonly keys: SigningKeySet | null,
    @Inject(PROVIDER_TOKEN_VERIFIERS) private readonly verifiers: ProviderTokenVerifiers,
    @Inject(GOOGLE_CODE_EXCHANGE) private readonly exchange: GoogleCodeExchange,
    @Inject(ProviderAccountService) private readonly accounts: ProviderAccountService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(IdentityDatabase) private readonly database: IdentityDatabase,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  /**
   * Step 1. @returns Google's address for this sign-in.
   * @throws ApiError `400 invalid_request` for a destination the API does not allow or a challenge that is not one;
   *   `503 not_configured` without a browser client or signing keys.
   */
  async authorizeUrl(query: Readonly<Record<string, unknown>>): Promise<string> {
    const { client, keys } = this.requireConfigured();
    const { redirect_to: redirectTo, code_challenge: challenge } = query;
    if (typeof redirectTo !== 'string' || !this.config.authRedirectUrls.includes(redirectTo) || typeof challenge !== 'string' || !CODE_CHALLENGE.test(challenge)) {
      throw new ApiError('invalid_request', 400);
    }
    const nonce = randomBytes(16).toString('base64url');
    const state = await new SignJWT({ r: redirectTo, c: challenge, n: nonce } satisfies SignInState)
      .setProtectedHeader({ alg: SIGNING_ALGORITHM, kid: keys.signingKeyId })
      .setIssuer(this.config.authIssuer)
      .setAudience(STATE_AUDIENCE)
      .setExpirationTime(Math.floor(Date.now() / 1000) + STATE_SECONDS)
      .sign(keys.signingKey);
    const url = new URL(GOOGLE_AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: this.callbackUrl(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      // The member chooses the account every time, as today.
      prompt: 'select_account',
    }).toString();
    return url.toString();
  }

  /**
   * Step 2. @returns The app's address, with `code` when the member is signed in and `error` when not.
   * @throws ApiError `400 invalid_request` when the state is not one this API made: then there is no address it may send anyone to.
   */
  async completeUrl(query: Readonly<Record<string, unknown>>): Promise<string> {
    const { client } = this.requireConfigured();
    const state = await this.readState(query.state);
    const back = (parameter: 'code' | 'error', value: string): string => {
      const url = new URL(state.r);
      url.searchParams.set(parameter, value);
      return url.toString();
    };
    // The member closed Google's page or refused: Google says so in `error` and sends no code.
    if (!isText(query.code, 2048)) return back('error', 'access_denied');
    const idToken = await this.exchange(
      new URLSearchParams({ code: query.code, client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: this.callbackUrl(), grant_type: 'authorization_code' }),
    );
    if (!idToken) return back('error', 'sign_in_failed');
    try {
      const account = await this.verifiers.google.verify(idToken, state.n);
      return back('code', await this.database.runAsService(async (db) => issueSignInCode(db, await this.accounts.memberOf(db, account), state.c)));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'email_not_verified') return back('error', 'email_not_verified');
      if (!(error instanceof InvalidProviderTokenError)) throw error;
      this.logger.info({ reason: error.message }, 'google browser sign-in: token rejected');
      return back('error', 'sign_in_failed');
    }
  }

  /**
   * Step 3. `{ code, codeVerifier }` → a session.
   * @throws ApiError `400 invalid_request`; `401 invalid_code` for a code that was used, expired, or is presented without the secret it was issued for.
   */
  async redeem(body: unknown): Promise<SessionResponse> {
    const { code, codeVerifier } = (body ?? {}) as Record<string, unknown>;
    if (!isText(code, 200) || typeof codeVerifier !== 'string' || !CODE_VERIFIER.test(codeVerifier)) throw new ApiError('invalid_request', 400);
    return this.database.runAsService(async (db) => {
      const userId = await redeemSignInCode(db, code, codeVerifier);
      if (!userId) throw new ApiError('invalid_code', 401);
      return this.sessions.openFor(db, userId);
    });
  }

  private callbackUrl(): string {
    return `${this.config.authIssuer}${GOOGLE_CALLBACK_PATH}`;
  }

  private async readState(state: unknown): Promise<SignInState> {
    const { keys } = this.requireConfigured();
    if (!isText(state, 4096)) throw new ApiError('invalid_request', 400);
    try {
      const { payload } = await jwtVerify(state, keys.verificationKeys, { issuer: this.config.authIssuer, audience: STATE_AUDIENCE, algorithms: [SIGNING_ALGORITHM], requiredClaims: ['exp'] });
      return payload as unknown as SignInState;
    } catch (error) {
      if (!(error instanceof errors.JOSEError)) throw error;
      throw new ApiError('invalid_request', 400, `sign-in state: ${error.code}`);
    }
  }

  private requireConfigured(): { client: NonNullable<ApiConfig['signIn']['googleBrowserClient']>; keys: SigningKeySet } {
    const client = this.config.signIn.googleBrowserClient;
    if (!client || !this.keys) throw new ApiError('not_configured', 503, 'google browser sign-in is not configured');
    return { client, keys: this.keys };
  }
}
