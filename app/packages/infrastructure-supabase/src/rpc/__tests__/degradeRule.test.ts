import { describe, expect, it } from 'vitest';
import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import { backendObjectKind, isBackendObjectMissing, toBackendUnavailable } from '../backendUnavailable';
import { mapRpcError, rpcErrorReason, unwrapCall } from '../mapRpcError';

describe('isBackendObjectMissing', () => {
  it.each([
    ['PGRST202', 'function'],
    ['42883', 'function'],
    ['PGRST205', 'relation'],
    ['PGRST200', 'relation'],
    ['42P01', 'relation'],
    ['3F000', 'relation'],
    ['PGRST204', 'column'],
    ['42703', 'column'],
  ])('treats %s as a missing %s', (code, kind) => {
    expect(backendObjectKind({ code, message: 'whatever' })).toBe(kind);
  });

  it('treats a missing grant (42501 + "permission denied for …") as missing', () => {
    expect(backendObjectKind({ code: '42501', message: 'permission denied for function feed_page' })).toBe('function');
    expect(backendObjectKind({ code: '42501', message: 'permission denied for table chats' })).toBe('relation');
    expect(backendObjectKind({ code: '42501', message: 'permission denied for schema kc_private' })).toBe('relation');
  });

  it('does not treat unauthenticated or an RLS refusal (also 42501) as missing', () => {
    expect(isBackendObjectMissing({ code: '42501', message: 'unauthenticated' })).toBe(false);
    expect(isBackendObjectMissing({ code: '42501', message: 'new row violates row-level security policy for table "posts"' })).toBe(false);
  });

  it('does not treat refusals, constraint errors or empty results as missing', () => {
    for (const code of ['P0001', '23505', '23503', 'PGRST116', '22P02', '57014']) {
      expect(isBackendObjectMissing({ code, message: 'post_not_found' })).toBe(false);
    }
    expect(isBackendObjectMissing(null)).toBe(false);
    expect(isBackendObjectMissing(undefined)).toBe(false);
  });

  it('reads the wording of a PostgREST that sent no code', () => {
    expect(backendObjectKind({ message: "Could not find the function public.x(p_a) in the schema cache" })).toBe('function');
    expect(backendObjectKind({ message: "Could not find the table 'public.x' in the schema cache" })).toBe('relation');
    expect(backendObjectKind({ message: "Could not find the 'foo' column of 'x' in the schema cache" })).toBe('column');
  });

  it('reads a 404 from an Edge Function and a missing bucket', () => {
    expect(backendObjectKind({ name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status: 404 } })).toBe('edge_function');
    expect(isBackendObjectMissing({ name: 'FunctionsHttpError', message: 'x', context: { status: 500 } })).toBe(false);
    expect(backendObjectKind({ name: 'StorageApiError', message: 'Bucket not found', statusCode: '404' })).toBe('bucket');
  });
});

describe('toBackendUnavailable', () => {
  it('names the object and keeps the cause', () => {
    const cause = { code: 'PGRST202', message: 'nope' };
    const error = toBackendUnavailable('rpc:feed_page', cause);
    expect(error).toBeInstanceOf(BackendUnavailableError);
    expect(error).toMatchObject({ object: 'rpc:feed_page', kind: 'function', code: 'backend_unavailable', cause });
  });

  it('returns null for a real error', () => {
    expect(toBackendUnavailable('rpc:x', { code: 'P0001', message: 'post_not_found' })).toBeNull();
  });
});

describe('mapRpcError', () => {
  it('maps P0001 with a snake_case message to a rule error carrying the reason', () => {
    const error = mapRpcError('rpc:close_post', { code: 'P0001', message: 'post_not_found' });
    expect(error).toBeInstanceOf(BackendRuleError);
    expect(error).toMatchObject({ reason: 'post_not_found', object: 'rpc:close_post' });
  });

  it('maps 42501 unauthenticated to the reason "unauthenticated"', () => {
    expect(rpcErrorReason({ code: '42501', message: 'unauthenticated' })).toBe('unauthenticated');
  });

  it('does not invent a reason from free text or from other codes', () => {
    expect(rpcErrorReason({ code: 'P0001', message: 'Something went wrong!' })).toBeNull();
    expect(rpcErrorReason({ code: '23505', message: 'duplicate_key' })).toBeNull();
    expect(rpcErrorReason({ code: 'P0001', message: 'פוסט' })).toBeNull();
  });

  it('prefers "unavailable" over a reason, and keeps unknown errors as plain errors', () => {
    expect(mapRpcError('rpc:x', { code: '42883', message: 'function x() does not exist' })).toBeInstanceOf(BackendUnavailableError);
    const unknown = mapRpcError('rpc:x', { code: '57014', message: 'canceling statement due to statement timeout' });
    expect(unknown).not.toBeInstanceOf(BackendRuleError);
    expect(unknown.message).toContain('statement timeout');
  });
});

describe('unwrapCall', () => {
  it('returns the data of a successful call', () => {
    expect(unwrapCall('rpc:x', { data: [1, 2], error: null })).toEqual([1, 2]);
  });

  it('throws the mapped error of a failed call', () => {
    expect(() => unwrapCall('rpc:x', { data: null, error: { code: 'PGRST202', message: 'x' } })).toThrow(BackendUnavailableError);
    expect(() => unwrapCall('rpc:x', { data: null, error: { code: 'P0001', message: 'forbidden' } })).toThrow(BackendRuleError);
  });
});
