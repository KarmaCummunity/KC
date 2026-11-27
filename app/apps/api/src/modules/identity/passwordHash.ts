// Password hashes of KC's own identity (ADR-013 section 3). A password set on KC is hashed with
// scrypt from the platform's own cryptography. A hash carried over from Supabase Auth is bcrypt:
// it is verified as such, and replaced by a scrypt one the next time its owner signs in.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';

/**
 * scrypt's cost: 2^15 blocks of 8 KiB each, three passes. One hash takes
 * about 32 MiB of memory, a size a small instance can afford several of at
 * once, and is one of the settings OWASP lists for scrypt.
 */
const COST = { N: 2 ** 15, r: 8, p: 3 } as const;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
/** Memory scrypt may use: its need at this cost, with room to spare. */
const MAX_MEMORY_BYTES = 64 * 1024 * 1024;
const SCRYPT_PREFIX = 'scrypt';

/** What checking a password against a stored hash came to. */
export interface PasswordCheck {
  readonly matches: boolean;
  /** True when the stored hash is not in the form KC makes today, and should be replaced now that the password is known. */
  readonly outdated: boolean;
}

function derive(password: string, salt: Buffer, cost: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_BYTES, { ...cost, maxmem: MAX_MEMORY_BYTES }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/**
 * A new hash of `password`, as `scrypt$<N>$<r>$<p>$<salt>$<key>` (the last
 * two in base64url). The cost is part of the text, so it can be raised later
 * without losing the ability to check older hashes.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, COST);
  return [SCRYPT_PREFIX, COST.N, COST.r, COST.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

async function checkScrypt(password: string, stored: string): Promise<PasswordCheck> {
  const [, n, r, p, salt, key] = stored.split('$');
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  const expected = Buffer.from(key ?? '', 'base64url');
  // A stored value that is not a hash this module made matches nothing; it is never an error a caller could tell apart.
  if (!Number.isInteger(cost.N) || !Number.isInteger(cost.r) || !Number.isInteger(cost.p) || !salt || expected.length !== KEY_BYTES) return { matches: false, outdated: false };
  const actual = await derive(password, Buffer.from(salt, 'base64url'), cost).catch(() => null);
  return {
    matches: actual !== null && timingSafeEqual(actual, expected),
    outdated: cost.N !== COST.N || cost.r !== COST.r || cost.p !== COST.p,
  };
}

/**
 * Checks `password` against a stored hash of either form.
 * @returns Whether it matches, and whether the hash should be replaced by a fresh one.
 */
export async function checkPassword(password: string, stored: string): Promise<PasswordCheck> {
  if (stored.startsWith(`${SCRYPT_PREFIX}$`)) return checkScrypt(password, stored);
  // bcrypt, as Supabase Auth made it. The library answers false for text that is not a bcrypt hash.
  if (/^\$2[aby]\$/.test(stored)) return { matches: await bcrypt.compare(password, stored).catch(() => false), outdated: true };
  return { matches: false, outdated: false };
}

/**
 * Spends the time of one real check without a hash to check against, so
 * that "no such account" takes as long to answer as "wrong password" and the
 * difference tells nobody which addresses are registered (D-22).
 */
export async function spendCheckTime(password: string): Promise<void> {
  await derive(password, DECOY_SALT, COST);
}

const DECOY_SALT = randomBytes(SALT_BYTES);
