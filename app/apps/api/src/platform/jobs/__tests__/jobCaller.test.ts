import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, type JWTVerifyGetKey, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../../__tests__/support/testConfig';
import { JobCaller } from '../jobCaller';

const AUDIENCE = 'https://api.kc.test';
const SCHEDULER = 'kc-scheduler@kc-test.iam.gserviceaccount.com';
const JOBS_TOKEN = 't'.repeat(32);
const SCHEDULER_CONFIG = { jobsScheduler: { audience: AUDIENCE, serviceAccount: SCHEDULER } };

type Signer = (claims?: JWTPayload, options?: { issuer?: string; audience?: string; expiresIn?: string }) => Promise<string>;

describe('JobCaller', () => {
  let googleKeys: JWTVerifyGetKey;
  /** An identity token as Google issues one for the scheduler, unless told otherwise. */
  let googleToken: Signer;
  /** The same token, signed by a key Google never published. */
  let forgedToken: Signer;

  beforeAll(async () => {
    const google = await generateKeyPair('RS256');
    const stranger = await generateKeyPair('RS256');
    googleKeys = createLocalJWKSet({ keys: [{ ...(await exportJWK(google.publicKey)), kid: 'google-key', alg: 'RS256' }] });
    const signerOf =
      (key: CryptoKey): Signer =>
      (claims = {}, options = {}) =>
        new SignJWT({ email: SCHEDULER, email_verified: true, ...claims })
          .setProtectedHeader({ alg: 'RS256', kid: 'google-key' })
          .setIssuer(options.issuer ?? 'https://accounts.google.com')
          .setAudience(options.audience ?? AUDIENCE)
          .setIssuedAt()
          .setExpirationTime(options.expiresIn ?? '5m')
          .sign(key);
    googleToken = signerOf(google.privateKey);
    forgedToken = signerOf(stranger.privateKey);
  });

  const callerWith = (config: Parameters<typeof testConfig>[0], keys: JWTVerifyGetKey = googleKeys) => new JobCaller(testConfig(config), keys);

  it('is not configured when there is neither a jobs token nor a scheduler identity', () => {
    expect(callerWith({}).isConfigured).toBe(false);
    expect(callerWith({ jobsToken: JOBS_TOKEN }).isConfigured).toBe(true);
    expect(callerWith(SCHEDULER_CONFIG).isConfigured).toBe(true);
  });

  it('allows the scheduler by its own identity: Google\'s token for its service account, addressed to this API', async () => {
    const caller = callerWith(SCHEDULER_CONFIG);

    expect(await caller.isAllowed(await googleToken())).toBe(true);
    expect(await caller.isAllowed(await googleToken({}, { issuer: 'accounts.google.com' }))).toBe(true);
  });

  it('refuses a real Google token that is someone else\'s, unverified, or meant for another service', async () => {
    const caller = callerWith(SCHEDULER_CONFIG);

    expect(await caller.isAllowed(await googleToken({ email: 'someone@gmail.com' }))).toBe(false);
    expect(await caller.isAllowed(await googleToken({ email_verified: false }))).toBe(false);
    expect(await caller.isAllowed(await googleToken({ email: undefined }))).toBe(false);
    expect(await caller.isAllowed(await googleToken({}, { audience: 'https://another.service.test' }))).toBe(false);
  });

  it('refuses a token that is expired, from another issuer, forged, or not a token at all', async () => {
    const caller = callerWith(SCHEDULER_CONFIG);

    expect(await caller.isAllowed(await googleToken({}, { expiresIn: '-1m' }))).toBe(false);
    expect(await caller.isAllowed(await googleToken({}, { issuer: 'https://accounts.example.org' }))).toBe(false);
    expect(await caller.isAllowed(await forgedToken())).toBe(false);
    expect(await caller.isAllowed('not-a-token')).toBe(false);
    expect(await caller.isAllowed('')).toBe(false);
  });

  it('allows the jobs token, compared whole, and never treats it as an identity token', async () => {
    const caller = callerWith({ jobsToken: JOBS_TOKEN });

    expect(await caller.isAllowed(JOBS_TOKEN)).toBe(true);
    expect(await caller.isAllowed(JOBS_TOKEN.slice(1))).toBe(false);
    // Without a configured scheduler, Google's token proves nothing here.
    expect(await caller.isAllowed(await googleToken())).toBe(false);
  });

  it('allows either proof when both are configured', async () => {
    const caller = callerWith({ jobsToken: JOBS_TOKEN, ...SCHEDULER_CONFIG });

    expect(await caller.isAllowed(JOBS_TOKEN)).toBe(true);
    expect(await caller.isAllowed(await googleToken())).toBe(true);
    expect(await caller.isAllowed('w'.repeat(32))).toBe(false);
  });

  it('fails as a server fault when Google\'s keys cannot be reached: that says nothing about the caller', async () => {
    const unreachable: JWTVerifyGetKey = () => Promise.reject(new TypeError('fetch failed'));
    const caller = callerWith(SCHEDULER_CONFIG, unreachable);

    await expect(caller.isAllowed(await googleToken())).rejects.toThrow('fetch failed');
  });
});
