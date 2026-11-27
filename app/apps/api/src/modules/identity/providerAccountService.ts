import type { SessionResponse } from '@kc/infrastructure-api';
import { Inject, Injectable } from '@nestjs/common';
import { type DatabaseSession, IdentityDatabase } from '../../platform/database/identityDatabase';
import { ApiError } from '../../platform/errors/ApiError';
import { APP_LOGGER, type AppLogger } from '../../platform/logging/appLogger';
import { addProviderIdentity, findProviderMember, removeUnprovenEmailSignUp } from './credentialStore';
import { InvalidProviderTokenError, type ProviderAccount, type ProviderTokenVerifier, type SignInProvider } from './providerTokens';
import { SessionService } from './sessionService';

/** Injection token of the verifiers of each provider's ID tokens. */
export const PROVIDER_TOKEN_VERIFIERS = Symbol('PROVIDER_TOKEN_VERIFIERS');
export type ProviderTokenVerifiers = Readonly<Record<SignInProvider, ProviderTokenVerifier>>;

/** The longest ID token and nonce taken; real ones are far shorter. */
const MAX_TOKEN_LENGTH = 8192;
const MAX_NONCE_LENGTH = 256;

const isText = (value: unknown, maxLength: number): value is string => typeof value === 'string' && value !== '' && value.length <= maxLength;

/**
 * Sign-in through Google or Apple (ADR-013 section 3). A provider account
 * is recognized by the provider's own id of it, never by its address, so a
 * member who changes their address there stays the same member here.
 *
 * The first sign-in of a provider account either joins the member who
 * already has its address, or creates a member. It joins only on an address
 * the provider vouches for, which is the rule Supabase Auth applies today:
 * owning the address is what a password reset would prove too.
 */
@Injectable()
export class ProviderAccountService {
  constructor(
    @Inject(IdentityDatabase) private readonly database: IdentityDatabase,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(PROVIDER_TOKEN_VERIFIERS) private readonly verifiers: ProviderTokenVerifiers,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  /**
   * @param body `{ provider: 'google' | 'apple', token, nonce? }`.
   * @throws ApiError `400 invalid_request`; `401 invalid_provider_token` for a token that is not the provider's, not for
   *   KC, expired, or (Apple) not bound to the nonce; `403 email_not_verified` for a first sign-in whose address the
   *   provider does not vouch for.
   */
  async signInWithIdToken(body: unknown): Promise<SessionResponse> {
    const { provider, token, nonce } = (body ?? {}) as Record<string, unknown>;
    if ((provider !== 'google' && provider !== 'apple') || !isText(token, MAX_TOKEN_LENGTH) || (nonce !== undefined && !isText(nonce, MAX_NONCE_LENGTH))) {
      throw new ApiError('invalid_request', 400);
    }
    const account = await this.verifiers[provider].verify(token, nonce).catch((error: unknown) => {
      if (!(error instanceof InvalidProviderTokenError)) throw error;
      this.logger.info({ provider, reason: error.message }, 'provider token rejected');
      throw new ApiError('invalid_provider_token', 401, error.message);
    });
    return this.database.runAsService(async (db) => this.sessions.openFor(db, await this.memberOf(db, account)));
  }

  /** The member the provider account signs in as: the one it already is, the one who has its address, or a new one. */
  private async memberOf(db: DatabaseSession, account: ProviderAccount): Promise<string> {
    const known = await findProviderMember(db, account.provider, account.subject);
    if (known) return known;
    if (!account.email || !account.emailVerified) throw new ApiError('email_not_verified', 403);
    await db.query('savepoint first_sign_in');
    const userId = (await this.memberWithAddress(db, account.email)) ?? (await this.createMember(db, account));
    if (await addProviderIdentity(db, userId, account.provider, account.subject)) return userId;
    // Another first sign-in of the same account finished first: its member is the one, and what this request
    // prepared (a member row, perhaps) is undone.
    await db.query('rollback to savepoint first_sign_in');
    const winner = await findProviderMember(db, account.provider, account.subject);
    if (!winner) throw new Error('a provider identity was refused as taken and is not there');
    return winner;
  }

  /**
   * The member who already has the address, made ready to be signed in as:
   * the provider proved the address, so it counts as verified, and anything
   * an unverified sign-up left behind is removed first.
   */
  private async memberWithAddress(db: DatabaseSession, email: string): Promise<string | null> {
    const { rows } = await db.query<{ id: string | null; verified: boolean | null }>(
      `select o.id, (select u.email_confirmed_at is not null from kc_private.auth_session_user(o.id) u) as verified
         from (select kc_private.auth_user_id_by_email($1) as id) o`,
      [email],
    );
    const owner = rows[0];
    if (!owner?.id) return null;
    if (!owner.verified) {
      await removeUnprovenEmailSignUp(db, owner.id);
      await db.query('select kc_private.auth_user_confirm_email($1)', [owner.id]);
    }
    return owner.id;
  }

  private async createMember(db: DatabaseSession, account: ProviderAccount): Promise<string> {
    // Both names of each field, as the providers and the table's trigger read them.
    const profile = {
      ...(account.displayName ? { full_name: account.displayName, name: account.displayName } : {}),
      ...(account.avatarUrl ? { avatar_url: account.avatarUrl, picture: account.avatarUrl } : {}),
    };
    const { rows } = await db.query<{ id: string }>('select kc_private.auth_user_create($1, $2, true, $3::jsonb) as id', [account.email, account.provider, JSON.stringify(profile)]);
    return (rows[0] as { id: string }).id;
  }
}
