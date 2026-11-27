import { assertPasswordPolicy } from '@kc/application';
import { LINK_TOKEN_PARAMETER, LINK_TYPE_PARAMETER, type SessionResponse } from '@kc/infrastructure-api';
import { Inject, Injectable } from '@nestjs/common';
import { BackgroundWork } from '../../platform/background/backgroundWork';
import type { ApiConfig } from '../../platform/config/apiConfig';
import { API_CONFIG } from '../../platform/config/apiConfig.module';
import { IdentityDatabase } from '../../platform/database/identityDatabase';
import { ApiError } from '../../platform/errors/ApiError';
import type { CallerIdentity } from '../../platform/identity/callerIdentity';
import { canonicalEmail, createEmailAccount, findEmailAccount, issueLink, type LinkPurpose, redeemLink, storePassword, touchEmailIdentity } from './credentialStore';
import { EMAIL_SENDER, type EmailSender } from './emailSender';
import { checkPassword, hashPassword, spendCheckTime } from './passwordHash';
import { SessionService } from './sessionService';
import { endSessionsOf } from './sessionStore';

/** The longest address and password taken: an address cannot be longer, and a longer password only costs hashing time. */
const MAX_EMAIL_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 256;
const MAX_PROFILE_TEXT_LENGTH = 2000;
/** One `@`, something on both sides, a dot in the domain: enough to refuse what cannot be an address. Owning it is proven by the link. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The `type` a link of each purpose carries, which the app's screens already read. */
const LINK_TYPE: Readonly<Record<LinkPurpose, string>> = { verify_email: 'signup', reset_password: 'recovery' };

const isText = (value: unknown, maxLength: number): value is string => typeof value === 'string' && value !== '' && value.length <= maxLength;

/**
 * Accounts that sign in with an email address and a password (ADR-013
 * section 3). No answer of these methods says whether an address is
 * registered (D-22): sign-up, resend and recover answer alike for every
 * address, and a failed sign-in never says which of the two was wrong.
 */
@Injectable()
export class EmailAccountService {
  constructor(
    @Inject(IdentityDatabase) private readonly database: IdentityDatabase,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(BackgroundWork) private readonly background: BackgroundWork,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender | null,
  ) {}

  /**
   * Creates the account and sends its verification link. The member signs in
   * only after opening the link.
   * @throws ApiError `400 invalid_request`, `400 weak_password`, `503 not_configured` (no email provider).
   */
  async signUp(body: unknown): Promise<void> {
    const { email, password } = readCredentials(body);
    const redirectTo = this.readRedirect(body);
    this.requireSender();
    requirePolicy(password);
    // Hashed before the address is looked up, so an address that is taken costs the same time as one that is free.
    const passwordHash = await hashPassword(password);
    const link = await this.database.runAsService(async (db) => {
      const userId = await createEmailAccount(db, email, passwordHash);
      return userId ? issueLink(db, userId, 'verify_email') : null;
    });
    if (link) this.send(email, 'verify_email', redirectTo, link);
  }

  /**
   * @throws ApiError `400 invalid_request`; `401 invalid_credentials` for an address nobody signs in with or a wrong
   *   password; `403 email_not_confirmed` when the password is right and the address unverified.
   */
  async signIn(body: unknown): Promise<SessionResponse> {
    const { email, password } = readCredentials(body);
    const account = await this.database.runAsService((db) => findEmailAccount(db, email));
    if (!account?.passwordHash) {
      await spendCheckTime(password);
      throw new ApiError('invalid_credentials', 401);
    }
    const check = await checkPassword(password, account.passwordHash);
    if (!check.matches) throw new ApiError('invalid_credentials', 401);
    if (!account.emailVerified) throw new ApiError('email_not_confirmed', 403);
    // The password is known here and only here: a hash of an older form is replaced now.
    const replacement = check.outdated ? await hashPassword(password) : null;
    return this.database.runAsService(async (db) => {
      if (replacement) await storePassword(db, account.userId, replacement);
      await touchEmailIdentity(db, account.userId);
      return this.sessions.openFor(db, account.userId);
    });
  }

  /**
   * Redeems a link and signs its member in. Either kind proves the address
   * is the member's, so both mark it verified.
   * @throws ApiError `400 invalid_request`; `401 invalid_link` for a link that was used, expired, or never issued.
   */
  async verify(body: unknown): Promise<SessionResponse> {
    const { token, type } = (body ?? {}) as Record<string, unknown>;
    const purpose = (Object.keys(LINK_TYPE) as LinkPurpose[]).find((candidate) => LINK_TYPE[candidate] === type);
    if (!isText(token, 200) || !purpose) throw new ApiError('invalid_request', 400);
    return this.database.runAsService(async (db) => {
      const userId = await redeemLink(db, token, purpose);
      if (!userId) throw new ApiError('invalid_link', 401);
      await db.query('select kc_private.auth_user_confirm_email($1)', [userId]);
      return this.sessions.openFor(db, userId);
    });
  }

  /** Sends the verification link again to an account that still needs it; at most one a minute. */
  async resendVerification(body: unknown): Promise<void> {
    await this.sendLinkTo(body, 'verify_email', (account) => !account.emailVerified);
  }

  /** Sends a password reset link to an account that signs in with this address; at most one a minute. */
  async recover(body: unknown): Promise<void> {
    await this.sendLinkTo(body, 'reset_password', () => true);
  }

  /**
   * Sets the caller's password and ends every session they have, this one
   * included (FR-AUTH-008 AC2): they sign in again with the new password.
   * @throws ApiError `400 weak_password`; `400 invalid_request` for a member who does not sign in with an email address.
   */
  async setPassword(caller: CallerIdentity, body: unknown): Promise<void> {
    const { password } = (body ?? {}) as Record<string, unknown>;
    if (!isText(password, MAX_PASSWORD_LENGTH)) throw new ApiError('invalid_request', 400);
    requirePolicy(password);
    const passwordHash = await hashPassword(password);
    await this.database.runAsService(async (db) => {
      const identity = await db.query("select 1 from kc_private.auth_identities where user_id = $1 and provider = 'email'", [caller.userId]);
      if (identity.rowCount !== 1) throw new ApiError('invalid_request', 400, 'the member has no email identity');
      await storePassword(db, caller.userId, passwordHash);
      await endSessionsOf(db, caller.userId, 'password_reset');
    });
  }

  /**
   * Keeps the name and picture of the caller's sign-in profile in step with
   * the product's own (D-38). Both fields are written under the two names
   * the providers use, as the app's adapter writes them today.
   * @throws ApiError `400 invalid_request`
   */
  async updateProfile(caller: CallerIdentity, body: unknown): Promise<void> {
    const { displayName, avatarUrl } = (body ?? {}) as Record<string, unknown>;
    const given = [displayName, avatarUrl].filter((value) => value !== undefined);
    if (given.length === 0 || !given.every((value) => isText(value, MAX_PROFILE_TEXT_LENGTH))) throw new ApiError('invalid_request', 400);
    const patch = {
      ...(displayName === undefined ? {} : { full_name: displayName, name: displayName }),
      ...(avatarUrl === undefined ? {} : { avatar_url: avatarUrl, picture: avatarUrl }),
    };
    await this.database.runAsService((db) => db.query('select kc_private.auth_user_merge_profile($1, $2::jsonb)', [caller.userId, JSON.stringify(patch)]));
  }

  private async sendLinkTo(body: unknown, purpose: LinkPurpose, wanted: (account: { emailVerified: boolean }) => boolean): Promise<void> {
    const { email } = (body ?? {}) as Record<string, unknown>;
    if (!isText(email, MAX_EMAIL_LENGTH) || !EMAIL_SHAPE.test(email)) throw new ApiError('invalid_request', 400);
    const redirectTo = this.readRedirect(body);
    this.requireSender();
    const link = await this.database.runAsService(async (db) => {
      const account = await findEmailAccount(db, email);
      return account && wanted(account) ? issueLink(db, account.userId, purpose) : null;
    });
    if (link) this.send(email, purpose, redirectTo, link);
  }

  /**
   * Hands the email to the provider after the request was answered: how long
   * a provider takes must not show whether an email was sent at all.
   */
  private send(email: string, kind: LinkPurpose, redirectTo: string, token: string): void {
    const link = new URL(redirectTo);
    link.searchParams.set(LINK_TOKEN_PARAMETER, token);
    link.searchParams.set(LINK_TYPE_PARAMETER, LINK_TYPE[kind]);
    const sender = this.requireSender();
    this.background.start(`identity email: ${kind}`, () => sender.send({ to: canonicalEmail(email), kind, link: link.toString() }));
  }

  /** The address a link will lead to: it must be one the API was configured to allow, exactly. */
  private readRedirect(body: unknown): string {
    const { redirectTo } = (body ?? {}) as Record<string, unknown>;
    if (typeof redirectTo !== 'string' || !this.config.authRedirectUrls.includes(redirectTo)) throw new ApiError('invalid_request', 400, 'redirect address not allowed');
    return redirectTo;
  }

  private requireSender(): EmailSender {
    if (!this.sender) throw new ApiError('not_configured', 503, 'this server has no email provider');
    return this.sender;
  }
}

function readCredentials(body: unknown): { email: string; password: string } {
  const { email, password } = (body ?? {}) as Record<string, unknown>;
  if (!isText(email, MAX_EMAIL_LENGTH) || !EMAIL_SHAPE.test(email) || !isText(password, MAX_PASSWORD_LENGTH)) throw new ApiError('invalid_request', 400);
  return { email, password };
}

/** @throws ApiError `400 weak_password` for a password the shared policy (FR-AUTH-006 AC1) refuses. */
function requirePolicy(password: string): void {
  try {
    assertPasswordPolicy(password);
  } catch {
    throw new ApiError('weak_password', 400);
  }
}
