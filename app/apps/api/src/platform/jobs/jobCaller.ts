import { Inject, Injectable } from '@nestjs/common';
import { errors, type JWTVerifyGetKey, jwtVerify } from 'jose';
import type { ApiConfig } from '../config/apiConfig';
import { API_CONFIG } from '../config/apiConfig.module';
import { equalInConstantTime } from '../security/constantTime';

/** Injection token of the keys Google signs its identity tokens with. */
export const GOOGLE_IDENTITY_KEYS = Symbol('GOOGLE_IDENTITY_KEYS');
/** Where Google publishes those keys. */
export const GOOGLE_IDENTITY_KEYS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
/** Google signs an identity token under either spelling of its name. */
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/**
 * Decides whether the caller of `POST /v1/jobs/<name>` may start a job. No
 * member is involved, so there are two proofs, each used only when configured:
 *
 * - **The scheduler's own identity** (`KC_JOBS_OIDC_AUDIENCE` and
 *   `KC_JOBS_SERVICE_ACCOUNT`): a short-lived token Google signs for the
 *   scheduler's service account, addressed to this API. Nothing secret is
 *   stored in the scheduler, and the token cannot be replayed elsewhere.
 * - **The jobs token** (`KC_JOBS_TOKEN`): a shared secret, for a scheduler
 *   that cannot present an identity (the database's own scheduler today).
 */
@Injectable()
export class JobCaller {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(GOOGLE_IDENTITY_KEYS) private readonly googleKeys: JWTVerifyGetKey,
  ) {}

  /** False when neither proof is configured: no job can be started over HTTP. */
  get isConfigured(): boolean {
    return this.config.jobsToken !== null || this.config.jobsScheduler !== null;
  }

  /**
   * @param bearer The bearer token of the request; empty when none was sent.
   * @throws When Google's keys cannot be reached: that says nothing about the caller, so it is a fault of the server, which a scheduler retries.
   */
  async isAllowed(bearer: string): Promise<boolean> {
    const { jobsToken, jobsScheduler } = this.config;
    if (jobsToken !== null && equalInConstantTime(bearer, jobsToken)) return true;
    if (jobsScheduler === null || bearer === '') return false;
    try {
      const { payload } = await jwtVerify(bearer, this.googleKeys, {
        issuer: GOOGLE_ISSUERS,
        audience: jobsScheduler.audience,
        algorithms: ['RS256'],
        requiredClaims: ['exp', 'email'],
      });
      // Any Google account can get a token for any audience: what matters is whose token it is.
      return payload.email === jobsScheduler.serviceAccount && payload.email_verified === true;
    } catch (error) {
      if (!(error instanceof errors.JOSEError) || error instanceof errors.JWKSTimeout) throw error;
      return false;
    }
  }
}
