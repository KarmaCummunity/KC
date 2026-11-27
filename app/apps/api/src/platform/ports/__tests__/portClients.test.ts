import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { IdentityDatabase } from '../../database/identityDatabase';
import type { AppLogger } from '../../logging/appLogger';
import { errorCodeOf, PortClients } from '../portClients';

/** A catalog with one table, so the engine plans requests without a database. */
const catalog = (text: string) =>
  Promise.resolve({ rows: text.includes('pg_class') && !text.includes('pg_constraint') ? [{ name: 'books' }] : [] });

function setup(answer: () => Promise<unknown>) {
  const error = vi.fn();
  // Typed loosely on purpose: the test only looks at who each request ran as.
  const database = { runAs: vi.fn<(caller: unknown, work: unknown) => Promise<unknown>>(answer), runAnonymous: vi.fn<(work: unknown) => Promise<unknown>>(answer) };
  const clients = new PortClients({ query: catalog } as unknown as Pool, database as unknown as IdentityDatabase, { error } as unknown as AppLogger);
  return { clients, database, error };
}

const caller = { userId: '11111111-1111-4111-8111-111111111111', claims: { sub: '11111111-1111-4111-8111-111111111111' } };

describe('PortClients', () => {
  it('runs a member request as that member and a visitor request as a visitor', async () => {
    const { clients, database } = setup(() => Promise.resolve({ body: '[]', row_count: 0 }));

    await clients.clientFor(caller).from('books').select('id');
    await clients.clientFor(null).from('books').select('id');

    expect(database.runAs).toHaveBeenCalledTimes(1);
    expect(database.runAs.mock.calls[0]?.[0]).toBe(caller);
    expect(database.runAnonymous).toHaveBeenCalledTimes(1);
  });

  it('logs a request the engine cannot serve, with its path and never its values', async () => {
    const { clients, error } = setup(() => Promise.resolve({ body: '[]', row_count: 0 }));

    const result = await clients.clientFor(caller).from('books').select('id').textSearch('title', 'a secret phrase');

    expect(result.error).toMatchObject({ code: 'PGRST100' });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toMatchObject({ code: 'PGRST100', method: 'GET', path: '/rest/v1/books' });
    expect(JSON.stringify(error.mock.calls[0])).not.toContain('secret phrase');
  });

  it('does not log what the database refuses: that is a matter for the caller, not a fault', async () => {
    const refusal = Object.assign(new Error('post_not_found'), { code: 'P0001' });
    const { clients, error } = setup(() => Promise.reject(refusal));

    const result = await clients.clientFor(caller).from('books').select('id');

    expect(result.error).toMatchObject({ code: 'P0001', message: 'post_not_found' });
    expect(error).not.toHaveBeenCalled();
  });
});

describe('errorCodeOf', () => {
  it('reads the code of an error answer and nothing from a success or a body that is not JSON', () => {
    expect(errorCodeOf({ status: 400, headers: {}, body: '{"code":"PGRST100"}' })).toBe('PGRST100');
    expect(errorCodeOf({ status: 200, headers: {}, body: '[]' })).toBeNull();
    expect(errorCodeOf({ status: 500, headers: {}, body: null })).toBeNull();
    expect(errorCodeOf({ status: 500, headers: {}, body: 'not json' })).toBeNull();
    expect(errorCodeOf({ status: 400, headers: {}, body: '{}' })).toBeNull();
  });
});
