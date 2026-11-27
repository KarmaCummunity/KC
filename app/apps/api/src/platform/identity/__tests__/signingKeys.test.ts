import { jwtVerify, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { InvalidSigningKeysError, loadSigningKeys } from '../signingKeys';
import { privateJwk } from './signingKeyFixtures';

const setOf = (...keys: unknown[]) => JSON.stringify({ keys });

describe('loadSigningKeys', () => {
  it('signs with the first key and verifies a token signed by any key of the set', async () => {
    const [current, previous] = [await privateJwk('2026-12'), await privateJwk('2026-11')];
    // The set as it was before the rotation: the key that is now second was the signer.
    const before = await loadSigningKeys(setOf(previous));
    const now = await loadSigningKeys(setOf(current, previous));
    const sign = (keys: typeof now) => new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: keys.signingKeyId }).sign(keys.signingKey);

    expect(now.signingKeyId).toBe('2026-12');
    await expect(jwtVerify(await sign(now), now.verificationKeys)).resolves.toBeDefined();
    await expect(jwtVerify(await sign(before), now.verificationKeys)).resolves.toBeDefined();
    // A set that no longer holds a key does not verify what that key signed.
    await expect(jwtVerify(await sign(now), before.verificationKeys)).rejects.toThrow();
  });

  it('publishes the public half of every key and nothing of the private half', async () => {
    const keys = await loadSigningKeys(setOf({ ...(await privateJwk('a')), extra: 'not published' }, await privateJwk('b')));

    expect(keys.publicKeys.map((key) => key.kid)).toEqual(['a', 'b']);
    for (const key of keys.publicKeys) expect(Object.keys(key).sort()).toEqual(['alg', 'crv', 'kid', 'kty', 'use', 'x', 'y']);
    expect(JSON.stringify(keys.publicKeys)).not.toContain('"d"');
  });

  it.each([
    ['text that is not JSON', async () => 'not json'],
    ['a set without keys', async () => setOf()],
    ['something that is not a set', async () => '[]'],
    ['a public key', async () => setOf({ ...(await privateJwk('a')), d: undefined })],
    ['a key without an id', async () => setOf({ ...(await privateJwk('a')), kid: undefined })],
    ['a key of another curve', async () => setOf({ ...(await privateJwk('a')), crv: 'P-384' })],
    ['two keys with one id', async () => setOf(await privateJwk('a'), await privateJwk('a'))],
    ['a private value that is not a key', async () => setOf({ ...(await privateJwk('a')), d: 'AAAA' })],
  ])('refuses %s, without repeating any of it', async (_what, text) => {
    const failure = await loadSigningKeys(await text()).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(InvalidSigningKeysError);
    expect((failure as Error).message).toMatch(/^Invalid signing keys: [a-zA-Z0-9 -]+$/);
  });
});
