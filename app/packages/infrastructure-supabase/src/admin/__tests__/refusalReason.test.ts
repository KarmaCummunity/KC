import { describe, expect, it } from 'vitest';
import { BackendRuleError } from '@kc/domain';
import { mapRpcError } from '../../rpc/mapRpcError';
import { refusalReason } from '../refusalReason';

describe('refusalReason', () => {
  it('reads the reason of a P0001 refusal', () => {
    expect(refusalReason(mapRpcError('rpc:x', { code: 'P0001', message: 'report_not_open' }))).toBe('report_not_open');
    expect(refusalReason(new BackendRuleError('target_not_found', 'rpc:x'))).toBe('target_not_found');
  });

  it('reads the stable message of a 42501 refusal that mapRpcError leaves as a plain Error', () => {
    for (const message of ['forbidden', 'forbidden_grant', 'forbidden_revoke', 'unauthenticated']) {
      expect(refusalReason(mapRpcError('rpc:x', { code: '42501', message }))).toBe(message);
    }
  });

  it('treats a 42501 with an unstable message (RLS, grants) as a plain forbidden', () => {
    expect(refusalReason(mapRpcError('rpc:x', { code: '42501', message: 'new row violates row-level security policy' }))).toBe(
      'forbidden',
    );
  });

  it('is null for anything that is not a refusal', () => {
    expect(refusalReason(mapRpcError('rpc:x', { code: '23505', message: 'dup' }))).toBeNull();
    expect(refusalReason(mapRpcError('rpc:x', { message: 'connection reset' }))).toBeNull();
    expect(refusalReason('boom')).toBeNull();
    expect(refusalReason(null)).toBeNull();
  });
});
