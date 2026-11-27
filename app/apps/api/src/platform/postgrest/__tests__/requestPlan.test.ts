import { describe, expect, it } from 'vitest';
import { PostgrestCompatError } from '../compatError';
import { type CompatRequest, planRequest } from '../requestPlan';
import { BASE } from './support';

const request = (method: string, path: string, extra: Partial<CompatRequest> = {}): CompatRequest => ({
  method,
  url: `${BASE}${path}`,
  headers: {},
  body: null,
  ...extra,
});

describe('planRequest', () => {
  it('plans a read with filters, order, limit and offset', () => {
    const plan = planRequest(
      request('GET', '/books?select=id,title&author_id=eq.7&or=(a.eq.1,b.eq.2)&order=created_at.desc.nullslast,id&limit=20&offset=40'),
    );

    expect(plan).toMatchObject({
      kind: 'read',
      relation: 'books',
      limit: 20,
      offset: 40,
      count: false,
      head: false,
      singular: false,
      order: [
        { column: 'created_at', descending: true, nulls: 'last' },
        { column: 'id', descending: false, nulls: null },
      ],
    });
    expect(plan.kind === 'read' && plan.filters).toHaveLength(2);
  });

  it('reads the response shape from the method and headers', () => {
    const plan = planRequest(
      request('HEAD', '/books', { headers: { prefer: 'count=exact', accept: 'application/vnd.pgrst.object+json' } }),
    );

    expect(plan).toMatchObject({ count: true, head: true, singular: true });
  });

  it('plans a single insert from the body keys', () => {
    const plan = planRequest(request('POST', '/books', { body: '{"title":"a","author_id":"7"}' }));

    expect(plan).toMatchObject({ kind: 'insert', columns: ['title', 'author_id'], conflict: null, returning: null });
  });

  it('plans a bulk upsert that returns rows', () => {
    const plan = planRequest(
      request('POST', '/books?columns=%22title%22%2C%22isbn%22&on_conflict=isbn&select=id', {
        headers: { prefer: 'resolution=merge-duplicates,return=representation' },
        body: '[{"title":"a","isbn":"1"},{"title":"b","isbn":"2"}]',
      }),
    );

    expect(plan).toMatchObject({
      kind: 'insert',
      columns: ['title', 'isbn'],
      conflict: { target: ['isbn'], resolution: 'merge' },
      returning: [{ kind: 'column', column: 'id', alias: 'id' }],
    });
    expect(plan.kind === 'insert' && plan.rows).toHaveLength(2);
  });

  it('plans ignore-duplicates, updates and deletes', () => {
    expect(
      planRequest(request('POST', '/books?on_conflict=isbn', { headers: { prefer: 'resolution=ignore-duplicates' }, body: '{"isbn":"1"}' })),
    ).toMatchObject({ conflict: { resolution: 'ignore' } });
    expect(planRequest(request('PATCH', '/books?id=eq.1', { body: '{"title":"b"}' }))).toMatchObject({
      kind: 'update',
      patch: { title: 'b' },
      returning: null,
    });
    expect(planRequest(request('DELETE', '/books?not.or=(id.eq.1,id.eq.2)', { headers: { prefer: 'return=representation' } }))).toMatchObject({
      kind: 'delete',
      filters: [{ kind: 'group', operator: 'or', negated: true }],
      returning: [{ kind: 'all' }],
    });
  });

  it('plans a function call, with or without arguments', () => {
    expect(planRequest(request('POST', '/rpc/search_books', { body: '{"p_query":"x"}' }))).toMatchObject({
      kind: 'rpc',
      name: 'search_books',
      args: { p_query: 'x' },
    });
    expect(planRequest(request('POST', '/rpc/ping'))).toMatchObject({ kind: 'rpc', args: {} });
  });

  it.each([
    ['an unknown path', request('GET', '/a/b/c-d')],
    ['a function called with GET', request('GET', '/rpc/ping')],
    ['function arguments that are not an object', request('POST', '/rpc/ping', { body: '[1]' })],
    ['an insert body that is not an object', request('POST', '/books', { body: '[1]' })],
    ['an update body that is not an object', request('PATCH', '/books?id=eq.1', { body: '[]' })],
    ['an upsert without a conflict target', request('POST', '/books', { headers: { prefer: 'resolution=merge-duplicates' }, body: '{}' })],
    ['an estimated count', request('GET', '/books', { headers: { prefer: 'count=estimated' } })],
    ['a negative limit', request('GET', '/books?limit=-1')],
    ['ordering by an embedded resource', request('GET', '/books?order=authors(name)')],
    ['an unsupported method', request('PUT', '/books')],
  ])('rejects %s', (_case, bad) => {
    expect(() => planRequest(bad)).toThrow(PostgrestCompatError);
  });

  it('reports a body that is not JSON as a syntax error', () => {
    expect(() => planRequest(request('POST', '/books', { body: '{nope' }))).toThrow(SyntaxError);
  });
});
