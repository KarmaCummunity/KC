// What a member signs in with (ADR-013 section 3), as the statements that read and write it: an
// email identity with its password, and the single-use links sent to an address. Every function
// takes the transaction it runs in, as the service role.

import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSession } from '../../platform/database/identityDatabase';

/** What a link is for. */
export type LinkPurpose = 'verify_email' | 'reset_password';

/** How long a link works (FR-AUTH-006 AC4, FR-AUTH-008 AC2). */
export const LINK_SECONDS: Readonly<Record<LinkPurpose, number>> = { verify_email: 24 * 60 * 60, reset_password: 30 * 60 };
/** The shortest time between two emails of one kind to one member (FR-AUTH-006 AC2). */
export const LINK_COOLDOWN_SECONDS = 60;

const UNIQUE_VIOLATION = '23505';

/** An account that signs in with an email address. */
export interface EmailAccount {
  readonly userId: string;
  /** Null for an account that has no password (it was never set, or was carried over without one). */
  readonly passwordHash: string | null;
  readonly emailVerified: boolean;
}

/** The form an address is stored and compared in. */
export function canonicalEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The digest a link's token is stored and looked up by. */
function linkDigest(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/** The account whose email identity is `email`, or null. */
export async function findEmailAccount(db: DatabaseSession, email: string): Promise<EmailAccount | null> {
  const { rows } = await db.query<{ user_id: string; hash: string | null; verified: boolean }>(
    `select i.user_id, p.hash, u.email_confirmed_at is not null as verified
       from kc_private.auth_identities i
       left join kc_private.auth_passwords p on p.user_id = i.user_id
      cross join lateral kc_private.auth_session_user(i.user_id) u
      where i.provider = 'email' and i.subject = $1`,
    [canonicalEmail(email)],
  );
  const account = rows[0];
  return account ? { userId: account.user_id, passwordHash: account.hash, emailVerified: account.verified } : null;
}

/**
 * Creates an account for an address nobody has: the member's row (not yet
 * verified), its email identity and its password.
 * @returns The new member's id, or null when the address already belongs to a member, whatever they signed up with.
 */
export async function createEmailAccount(db: DatabaseSession, email: string, passwordHash: string): Promise<string | null> {
  const address = canonicalEmail(email);
  const taken = await db.query<{ id: string | null }>('select kc_private.auth_user_id_by_email($1) as id', [address]);
  if (taken.rows[0]?.id) return null;
  // Two sign-ups for one address at the same moment: the identity's uniqueness lets one through. The other is
  // undone to this point, so its member row does not stay behind.
  await db.query('savepoint create_email_account');
  try {
    const created = await db.query<{ id: string }>("select kc_private.auth_user_create($1, 'email', false, '{}'::jsonb) as id", [address]);
    const userId = (created.rows[0] as { id: string }).id;
    await db.query("insert into kc_private.auth_identities (user_id, provider, subject) values ($1, 'email', $2)", [userId, address]);
    await storePassword(db, userId, passwordHash);
    return userId;
  } catch (error) {
    if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
    await db.query('rollback to savepoint create_email_account');
    return null;
  }
}

/** Sets the member's password hash, replacing the one before. */
export async function storePassword(db: DatabaseSession, userId: string, passwordHash: string): Promise<void> {
  await db.query(
    `insert into kc_private.auth_passwords (user_id, hash) values ($1, $2)
     on conflict (user_id) do update set hash = excluded.hash, updated_at = now()`,
    [userId, passwordHash],
  );
}

/** Records that the identity was just used to sign in. */
export async function touchEmailIdentity(db: DatabaseSession, userId: string): Promise<void> {
  await db.query("update kc_private.auth_identities set last_sign_in_at = now() where user_id = $1 and provider = 'email'", [userId]);
}

/**
 * A new link for the member, replacing their earlier ones of the same
 * purpose, unless one was made within the cooldown.
 * @returns The link's token (256 random bits), or null inside the cooldown.
 */
export async function issueLink(db: DatabaseSession, userId: string, purpose: LinkPurpose): Promise<string | null> {
  const recent = await db.query(
    'select 1 from kc_private.auth_one_time_tokens where user_id = $1 and purpose = $2 and created_at > now() - make_interval(secs => $3) limit 1',
    [userId, purpose, LINK_COOLDOWN_SECONDS],
  );
  if ((recent.rowCount ?? 0) > 0) return null;
  await db.query('delete from kc_private.auth_one_time_tokens where user_id = $1 and purpose = $2', [userId, purpose]);
  const token = randomBytes(32).toString('base64url');
  await db.query('insert into kc_private.auth_one_time_tokens (token_hash, user_id, purpose, expires_at) values ($1, $2, $3, now() + make_interval(secs => $4))', [
    linkDigest(token),
    userId,
    purpose,
    LINK_SECONDS[purpose],
  ]);
  return token;
}

/**
 * Uses a link up. One statement decides and marks it, so of two requests
 * with the same token only one gets the member.
 * @returns The member the link was sent to, or null for a token that was used, expired, or never issued for this purpose.
 */
export async function redeemLink(db: DatabaseSession, token: string, purpose: LinkPurpose): Promise<string | null> {
  const { rows } = await db.query<{ user_id: string }>(
    `update kc_private.auth_one_time_tokens set used_at = now()
      where token_hash = $1 and purpose = $2 and used_at is null and expires_at > now()
      returning user_id`,
    [linkDigest(token), purpose],
  );
  return rows[0]?.user_id ?? null;
}
