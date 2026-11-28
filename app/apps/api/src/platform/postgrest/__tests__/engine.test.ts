import { describe, expect, it } from 'vitest';
import { handleCompatRequest, type StatementRunner } from '../engine';
import type { CompatRequest } from '../requestPlan';
import type { ResultRow } from '../sqlStatements';
import { BASE, cacheSource, TEST_CACHE } from './support';

const request = (method: string, path: string, extra: Partial<CompatRequest> = {}): CompatRequest => ({
  method,
  url: `${BASE}${path}`,
  headers: {},
  body: null,
  ...extra,
});

/** A runner that answers every statement with `row` and remembers what it ran. */
function runnerWith(row: ResultRow | undefined) {
  const statements: string[] = [];
  const run: StatementRunner = (statement) => {
    statements.push(statement.text);
    return Promise.resolve(row);
  };
  return { run, statements };
}

/** A runner that fails the way the database driver does. */
const failingWith = (fields: Record<string, unknown>): StatementRunner => () =>
  Promise.reject(Object.assign(new Error(String(fields.message ?? 'failed')), fields));

const answer = (req: CompatRequest, row: ResultRow | undefined) => handleCompatRequest(req, cacheSource(), runnerWith(row).run);

describe('handleCompatRequest: responses', () => {
  it('answers a read with the JSON Postgres produced and the row range', async () => {
    const response = await answer(request('GET', '/books?offset=10'), { body: '[{"id":1},{"id":2}]', row_count: 2 });

    expect(response).toMatchObject({ status: 200, body: '[{"id":1},{"id":2}]' });
    expect(response.headers['content-range']).toBe('10-11/*');
  });

  it('reports the total when a count was asked for, also for an empty page', async () => {
    const counted = { headers: { prefer: 'count=exact' } };

    expect((await answer(request('GET', '/books', counted), { body: '[]', row_count: 0, total: '57' })).headers['content-range']).toBe('*/57');
    expect((await answer(request('HEAD', '/books', counted), { body: '[{}]', row_count: 1, total: '57' })).body).toBeNull();
  });

  it('answers a single-object request with the object, or 406 when it is not exactly one row', async () => {
    const single = { headers: { accept: 'application/vnd.pgrst.object+json' } };

    expect((await answer(request('GET', '/books', single), { body: '[{"id":1}]', row_count: 1 })).body).toBe('{"id":1}');
    const none = await answer(request('GET', '/books', single), { body: '[]', row_count: 0 });
    expect(none.status).toBe(406);
    expect(JSON.parse(none.body ?? '')).toMatchObject({ code: 'PGRST116', details: 'The result contains 0 rows' });
  });

  it('reports the rows a change touched as PostgREST does: an update its rows, an insert and a delete none', async () => {
    const patch = request('PATCH', '/books?id=eq.1', { body: '{"a":1}' });

    expect((await answer(patch, { body: null, row_count: 1 })).headers['content-range']).toBe('0-0/*');
    expect((await answer(patch, { body: null, row_count: 3 })).headers['content-range']).toBe('0-2/*');
    expect((await answer(patch, { body: null, row_count: 0 })).headers['content-range']).toBe('*/*');
    expect((await answer(request('POST', '/books', { body: '{"a":1}' }), { body: null, row_count: 1 })).headers['content-range']).toBe('*/*');
    expect((await answer(request('DELETE', '/books?id=eq.1'), { body: null, row_count: 1 })).headers['content-range']).toBe('*/*');
  });

  it('counts a function that returns nothing as one result, and an empty set as none', async () => {
    expect((await answer(request('POST', '/rpc/ping'), { body: null, row_count: 0 })).headers['content-range']).toBe('0-0/*');
    expect((await answer(request('POST', '/rpc/ping'), { body: '[]', row_count: 0 })).headers['content-range']).toBe('*/*');
  });

  it('answers a created row asked for as one object with 201', async () => {
    const created = request('POST', '/books', { headers: { prefer: 'return=representation', accept: 'application/vnd.pgrst.object+json' }, body: '{"a":1}' });

    expect(await answer(created, { body: '[{"a":1}]', row_count: 1 })).toMatchObject({ status: 201, body: '{"a":1}' });
  });

  it('answers changes with 201 / 204 and no body unless rows were asked for', async () => {
    expect(await answer(request('POST', '/books', { body: '{"a":1}' }), { body: null, row_count: 0 })).toMatchObject({ status: 201, body: null });
    expect(await answer(request('DELETE', '/books?id=eq.1'), { body: null, row_count: 0 })).toMatchObject({ status: 204, body: null });
    expect(
      await answer(request('POST', '/books', { headers: { prefer: 'return=representation' }, body: '{"a":1}' }), { body: '[{"a":1}]', row_count: 1 }),
    ).toMatchObject({ status: 201, body: '[{"a":1}]' });
  });

  it('answers a function that returned SQL NULL with JSON null, and a void function with nothing', async () => {
    expect(await answer(request('POST', '/rpc/book_count', { body: '{"p_author":"7"}' }), { body: null, row_count: 1 })).toMatchObject({
      status: 200,
      body: 'null',
    });
    expect(await answer(request('POST', '/rpc/ping'), { body: null, row_count: 0 })).toMatchObject({ status: 204, body: null });
    expect(await answer(request('POST', '/rpc/ping'), undefined)).toMatchObject({ status: 204 });
  });
});

describe('handleCompatRequest: errors', () => {
  it('answers a refusal of its own in PostgREST JSON', async () => {
    const response = await answer(request('PATCH', '/books', { body: '{"a":1}' }), undefined);

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body ?? '')).toEqual({ code: '21000', details: null, hint: null, message: 'UPDATE requires a WHERE clause' });
  });

  it('answers a body that is not JSON', async () => {
    expect(JSON.parse((await answer(request('POST', '/books', { body: '{nope' }), undefined)).body ?? '')).toMatchObject({ code: 'PGRST102' });
  });

  // The statuses are PostgREST's own; the parity suite compares them with a real one.
  it.each([
    ['P0001', 400], // a function's `raise exception`
    ['P0002', 500], // any other PL/pgSQL error
    ['22P02', 400], // a value of the wrong form: the caller's request
    ['23514', 400], // a check constraint: the caller's request
    ['23503', 409],
    ['23505', 409],
    ['42501', 403],
    ['42883', 404],
    ['42P17', 500],
    ['40001', 500],
    ['08006', 503],
    ['53300', 503],
    ['57014', 500],
    ['57P01', 503],
    ['XX000', 500],
    ['PT404', 404], // a function that chose its own status
  ])('passes a database error %s through with its code, message, detail and hint', async (code, status) => {
    const run = failingWith({ code, message: 'post_not_found', detail: 'd', hint: 'h' });

    const response = await handleCompatRequest(request('GET', '/books'), cacheSource(), run);

    expect(response.status).toBe(status);
    expect(JSON.parse(response.body ?? '')).toEqual({ code, details: 'd', hint: 'h', message: 'post_not_found' });
  });

  it('tells a refused visitor to sign in (401) and a refused member that it is not theirs (403)', async () => {
    const refused = failingWith({ code: '42501', message: 'permission denied for table books' });

    expect((await handleCompatRequest(request('GET', '/books'), cacheSource(), refused, { isVisitor: true })).status).toBe(401);
    expect((await handleCompatRequest(request('GET', '/books'), cacheSource(), refused, { isVisitor: false })).status).toBe(403);
    expect((await handleCompatRequest(request('GET', '/books'), cacheSource(), refused)).status).toBe(403);
  });

  it('lets a failure that is not a database error through', async () => {
    const failure = new Error('socket hang up');

    await expect(handleCompatRequest(request('GET', '/books'), cacheSource(), () => Promise.reject(failure))).rejects.toBe(failure);
  });
});

describe('handleCompatRequest: schema cache', () => {
  it('answers PGRST205 / PGRST202 for an object the reloaded cache still lacks', async () => {
    const source = cacheSource();

    const table = await handleCompatRequest(request('GET', '/nope'), source, runnerWith(undefined).run);
    const fn = await handleCompatRequest(request('POST', '/rpc/nope'), source, runnerWith(undefined).run);

    expect(JSON.parse(table.body ?? '')).toMatchObject({ code: 'PGRST205' });
    expect(JSON.parse(fn.body ?? '')).toMatchObject({ code: 'PGRST202' });
    expect(source.reloads).toBe(2);
  });

  it('reloads once and serves an object added since the cache was loaded', async () => {
    const newer = { ...TEST_CACHE, relations: new Set([...TEST_CACHE.relations, 'reviews']) };
    const source = cacheSource(TEST_CACHE, newer);
    const { run, statements } = runnerWith({ body: '[]', row_count: 0 });

    const response = await handleCompatRequest(request('GET', '/reviews'), source, run);

    expect(response.status).toBe(200);
    expect(source.reloads).toBe(1);
    expect(statements[0]).toContain('"public"."reviews"');
  });

  it('does not reload for an object it already knows', async () => {
    const source = cacheSource();

    await handleCompatRequest(request('GET', '/books'), source, runnerWith({ body: '[]', row_count: 0 }).run);

    expect(source.reloads).toBe(0);
  });
});
