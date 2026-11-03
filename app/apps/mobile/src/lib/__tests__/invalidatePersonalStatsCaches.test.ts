import { describe, it, expect, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { invalidatePersonalStatsCaches } from '../invalidatePersonalStatsCaches';

function makeFakeQc(): { qc: QueryClient; calls: Array<{ queryKey: unknown }> } {
  const calls: Array<{ queryKey: unknown }> = [];
  const qc = {
    invalidateQueries: vi.fn((args: { queryKey: unknown }) => {
      calls.push({ queryKey: args.queryKey });
      return Promise.resolve();
    }),
  } as unknown as QueryClient;
  return { qc, calls };
}

describe('invalidatePersonalStatsCaches (FR-STATS-001 AC2)', () => {
  it('invalidates both user-profile and my-activity-timeline keyed by userId', () => {
    const { qc, calls } = makeFakeQc();
    invalidatePersonalStatsCaches(qc, 'u_1');
    expect(calls.map((c) => c.queryKey)).toEqual([
      ['user-profile', 'u_1'],
      ['my-activity-timeline', 'u_1'],
    ]);
  });

  it('is a no-op when userId is null (no calls fired)', () => {
    const { qc, calls } = makeFakeQc();
    invalidatePersonalStatsCaches(qc, null);
    expect(calls).toEqual([]);
  });

  it('is a no-op when userId is undefined', () => {
    const { qc, calls } = makeFakeQc();
    invalidatePersonalStatsCaches(qc, undefined);
    expect(calls).toEqual([]);
  });

  it('is a no-op for an empty-string userId (falsy)', () => {
    const { qc, calls } = makeFakeQc();
    invalidatePersonalStatsCaches(qc, '');
    expect(calls).toEqual([]);
  });

  it('passes the userId through verbatim (no trimming, no normalization)', () => {
    const { qc, calls } = makeFakeQc();
    invalidatePersonalStatsCaches(qc, '  spaced  ');
    expect(calls.map((c) => c.queryKey)).toEqual([
      ['user-profile', '  spaced  '],
      ['my-activity-timeline', '  spaced  '],
    ]);
  });
});
