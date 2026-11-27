// The sessions of KC's own identity and their refresh tokens (ADR-013 section 2), as the
// statements that read and write them. Every function takes the transaction it runs in, so a
// caller decides what else happens with it: a sign-in opens its session in the transaction that
// created the member.

import { createHash, randomBytes } from 'node:crypto';
import type { SessionUser } from '@kc/infrastructure-api';
import type { DatabaseSession } from '../../platform/database/identityDatabase';

/**
 * How long a refresh token that was already replaced is still accepted: two
 * requests of one app can race each other with the same token. The value
 * Supabase Auth is configured with today.
 */
export const REFRESH_REUSE_GRACE_SECONDS = 10;

/** Why a session ended, as stored. */
export type SessionEnd = 'signed_out' | 'signed_out_everywhere' | 'password_reset' | 'token_reuse';

/** A session that was opened or continued, and the refresh token that now continues it. */
export interface ContinuedSession {
  readonly userId: string;
  readonly sessionId: string;
  /** Handed to the member's device and stored nowhere else. */
  readonly refreshToken: string;
}

/**
 * What presenting a refresh token came to. `reused`: the token had been
 * replaced longer ago than the grace period, so it was copied; its session
 * was ended by this call.
 */
export type Rotation = ({ readonly outcome: 'rotated' } & ContinuedSession) | { readonly outcome: 'invalid' } | { readonly outcome: 'reused' };

/** The digest a refresh token is stored and looked up by. */
export function refreshTokenDigest(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/** 256 random bits: a token nobody can guess, so its digest needs no salt. */
function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Opens a session for a member who just proved who they are. */
export async function openSession(db: DatabaseSession, userId: string): Promise<ContinuedSession> {
  const { rows } = await db.query<{ id: string }>('insert into kc_private.auth_sessions (user_id) values ($1) returning id', [userId]);
  const sessionId = (rows[0] as { id: string }).id;
  return { userId, sessionId, refreshToken: await addRefreshToken(db, sessionId) };
}

async function addRefreshToken(db: DatabaseSession, sessionId: string): Promise<string> {
  const token = newRefreshToken();
  await db.query('insert into kc_private.auth_refresh_tokens (token_hash, session_id) values ($1, $2)', [refreshTokenDigest(token), sessionId]);
  return token;
}

interface PresentedToken {
  session_id: string;
  user_id: string;
  replaced: boolean;
  past_grace: boolean;
  live: boolean;
}

/**
 * Exchanges a refresh token for its successor. The token's row and its
 * session's row are locked, so two requests with the same token are decided
 * one after the other: the first replaces it, the second finds it replaced
 * and, inside the grace period, gets a token of its own for the same session.
 *
 * The caller must commit the transaction whatever the outcome: `reused` ends
 * the session, and that must not be undone by answering with a refusal.
 */
export async function rotateRefreshToken(db: DatabaseSession, presented: string): Promise<Rotation> {
  const { rows } = await db.query<PresentedToken>(
    `select t.session_id, s.user_id,
            t.replaced_at is not null as replaced,
            coalesce(t.replaced_at < now() - make_interval(secs => $2), false) as past_grace,
            kc_private.auth_session_is_live(s.id, s.user_id) as live
       from kc_private.auth_refresh_tokens t
       join kc_private.auth_sessions s on s.id = t.session_id
      where t.token_hash = $1
        for update of t, s`,
    [refreshTokenDigest(presented), REFRESH_REUSE_GRACE_SECONDS],
  );
  const token = rows[0];
  if (!token?.live) return { outcome: 'invalid' };
  if (token.past_grace) {
    await endSession(db, token.session_id, token.user_id, 'token_reuse');
    return { outcome: 'reused' };
  }
  if (!token.replaced) await db.query('update kc_private.auth_refresh_tokens set replaced_at = now() where token_hash = $1', [refreshTokenDigest(presented)]);
  await db.query('update kc_private.auth_sessions set refreshed_at = now() where id = $1', [token.session_id]);
  return { outcome: 'rotated', userId: token.user_id, sessionId: token.session_id, refreshToken: await addRefreshToken(db, token.session_id) };
}

/** Ends one session of a member; a session that already ended keeps its first reason. */
export async function endSession(db: DatabaseSession, sessionId: string, userId: string, reason: SessionEnd): Promise<void> {
  await db.query('update kc_private.auth_sessions set ended_at = now(), ended_reason = $3 where id = $1 and user_id = $2 and ended_at is null', [sessionId, userId, reason]);
}

/** Ends every open session of a member. @returns How many were open. */
export async function endSessionsOf(db: DatabaseSession, userId: string, reason: SessionEnd): Promise<number> {
  const ended = await db.query('update kc_private.auth_sessions set ended_at = now(), ended_reason = $2 where user_id = $1 and ended_at is null', [userId, reason]);
  return ended.rowCount ?? 0;
}

interface UserRow {
  id: string;
  email: string | null;
  email_confirmed_at: Date | null;
  phone: string | null;
  meta: { full_name?: unknown; name?: unknown; avatar_url?: unknown; picture?: unknown } | null;
  provider: string | null;
  created_at: Date;
}

const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/**
 * The member as a session describes them, read from the row everything hangs
 * off (`auth.users`) with the same precedence the app applies today: the
 * name is `full_name` before `name`, the picture `avatar_url` before `picture`.
 * @returns null when the member no longer exists.
 */
export async function readSessionUser(db: DatabaseSession, userId: string): Promise<SessionUser | null> {
  // The table itself is closed to the service role; the function returns only what a session needs of the row.
  const { rows } = await db.query<UserRow>('select * from kc_private.auth_session_user($1)', [userId]);
  const user = rows[0];
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.email_confirmed_at !== null,
    phone: user.phone,
    displayName: textOrNull(user.meta?.full_name) ?? textOrNull(user.meta?.name),
    avatarUrl: textOrNull(user.meta?.avatar_url) ?? textOrNull(user.meta?.picture),
    createdAt: user.created_at.toISOString(),
    provider: user.provider,
  };
}
