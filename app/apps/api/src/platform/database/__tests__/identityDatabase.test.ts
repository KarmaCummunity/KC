import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { USER_A } from '../../../__tests__/support/testTokens';
import { IDENTITY_SQL, IdentityDatabase } from '../identityDatabase';

/** A pooled connection that records what was sent and how it was released. */
class RecordingClient {
  readonly statements: string[] = [];
  readonly parameters: unknown[][] = [];
  released: 'no' | 'returned' | 'destroyed' = 'no';
  failOn: string | undefined;

  query(text: string, values: unknown[] = []): Promise<{ rows: unknown[] }> {
    this.statements.push(text);
    this.parameters.push(values);
    return text === this.failOn ? Promise.reject(new Error(`${text} failed`)) : Promise.resolve({ rows: [] });
  }

  release(destroy?: boolean): void {
    this.released = destroy ? 'destroyed' : 'returned';
  }
}

function setup(): { client: RecordingClient; database: IdentityDatabase } {
  const client = new RecordingClient();
  const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;
  return { client, database: new IdentityDatabase(pool) };
}

const caller = { userId: USER_A, claims: { sub: USER_A, role: 'authenticated' } };

describe('IdentityDatabase', () => {
  it('wraps the work in one transaction as the signed-in caller', async () => {
    const { client, database } = setup();

    const result = await database.runAs(caller, async (session) => {
      await session.query('select 1');
      return 'done';
    });

    expect(result).toBe('done');
    expect(client.statements).toEqual(['begin', expect.stringContaining('set_config'), 'select 1', 'commit']);
    expect(client.parameters[1]).toEqual(['authenticated', JSON.stringify(caller.claims)]);
    expect(client.released).toBe('returned');
  });

  it('scopes the role and claims to the transaction', async () => {
    const { client, database } = setup();

    await database.runAs(caller, () => Promise.resolve());

    // The third argument `true` is what stops the identity outliving the transaction.
    expect(client.statements[1]).toBe(IDENTITY_SQL);
    expect(IDENTITY_SQL.match(/set_config\(/g)).toHaveLength(3);
    expect(IDENTITY_SQL.match(/, true\)/g)).toHaveLength(3);
    expect(IDENTITY_SQL).not.toContain('false');
  });

  it('runs a signed-out visitor as the anon role with no user', async () => {
    const { client, database } = setup();

    await database.runAnonymous(() => Promise.resolve());

    expect(client.parameters[1]).toEqual(['anon', JSON.stringify({ role: 'anon' })]);
  });

  it('rolls back, returns the connection and rethrows when the work fails', async () => {
    const { client, database } = setup();
    const failure = new Error('handler failed');

    await expect(database.runAs(caller, () => Promise.reject(failure))).rejects.toBe(failure);

    expect(client.statements.at(-1)).toBe('rollback');
    expect(client.statements).not.toContain('commit');
    expect(client.released).toBe('returned');
  });

  it('destroys the connection when the rollback itself fails', async () => {
    const { client, database } = setup();
    client.failOn = 'rollback';

    await expect(database.runAs(caller, () => Promise.reject(new Error('handler failed')))).rejects.toThrow('handler failed');

    expect(client.released).toBe('destroyed');
  });

  it('rolls back when the commit fails', async () => {
    const { client, database } = setup();
    client.failOn = 'commit';

    await expect(database.runAs(caller, () => Promise.resolve())).rejects.toThrow('commit failed');

    expect(client.statements.at(-1)).toBe('rollback');
    expect(client.released).toBe('returned');
  });
});
