import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { checkPassword, hashPassword } from '../passwordHash';

describe('password hashes', () => {
  it('checks a password against the hash it made, and no other password', async () => {
    const stored = await hashPassword('correct horse 9');

    expect(await checkPassword('correct horse 9', stored)).toEqual({ matches: true, outdated: false });
    expect((await checkPassword('correct horse 8', stored)).matches).toBe(false);
    expect((await checkPassword('', stored)).matches).toBe(false);
  });

  it('makes a different hash of the same password every time, and stores nothing of the password', async () => {
    const [one, two] = [await hashPassword('same password 1'), await hashPassword('same password 1')];

    expect(one).not.toBe(two);
    expect(one).toMatch(/^scrypt\$32768\$8\$3\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(one).not.toContain('same');
  });

  it('treats two ways of typing the same characters as one password', async () => {
    // "é" as one code point, and as "e" followed by a combining accent.
    const stored = await hashPassword('café 2026');

    expect((await checkPassword('café 2026', stored)).matches).toBe(true);
  });

  it('checks a bcrypt hash carried over from Supabase Auth, and says it should be replaced', async () => {
    const carriedOver = bcrypt.hashSync('old password 1', 10);

    expect(await checkPassword('old password 1', carriedOver)).toEqual({ matches: true, outdated: true });
    expect((await checkPassword('old password 2', carriedOver)).matches).toBe(false);
  });

  it('says a hash made at another cost should be replaced, and still checks it', async () => {
    const stored = (await hashPassword('cheaper once 1')).replace('scrypt$32768$8$3$', 'scrypt$16384$8$1$');

    // The key was derived at the current cost, so at the cost the text now claims it cannot match: only the flag is asserted.
    expect((await checkPassword('cheaper once 1', stored)).outdated).toBe(true);
  });

  it.each([[''], ['plain text'], ['scrypt$'], ['scrypt$32768$8$3$c2FsdA$dG9vLXNob3J0'], ['scrypt$not$a$number$c2FsdA$' + 'A'.repeat(43)], ['$2a$10$tooshort'], ['$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA']])(
    'matches nothing against a stored value that is not a hash it knows: %j',
    async (stored) => {
      expect((await checkPassword('any password 1', stored)).matches).toBe(false);
    },
  );
});
