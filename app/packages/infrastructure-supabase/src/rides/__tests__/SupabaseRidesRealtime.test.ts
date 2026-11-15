import { describe, it, expect, vi } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { SupabaseRidesRealtime } from '../SupabaseRidesRealtime';

describe('SupabaseRidesRealtime (degraded: the baseline has no ride topics, M24)', () => {
  const subscriptions: Array<[string, (rt: SupabaseRidesRealtime, cb: { onChange: () => void; onError: () => void }) => () => void, string]> = [
    ['public ride inserts', (rt, cb) => rt.subscribeToPublicRideInserts(cb), 'channel:rides:public-feed'],
    ['own participant updates', (rt, cb) => rt.subscribeToUserParticipantUpdates('u1', cb), 'channel:rides:participants:user:u1'],
    ['participant inserts of a ride', (rt, cb) => rt.subscribeToRideParticipantInserts('r1', cb), 'channel:rides:participants:ride:r1'],
  ];

  it.each(subscriptions)('%s: reports the missing topic once and never signals a change', (_name, subscribe, object) => {
    const onChange = vi.fn();
    const onError = vi.fn();

    const unsubscribe = subscribe(new SupabaseRidesRealtime(), { onChange, onError });

    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0]![0] as BackendUnavailableError;
    expect(error).toBeInstanceOf(BackendUnavailableError);
    expect(error.object).toBe(object);
    expect(() => unsubscribe()).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not require an error sink', () => {
    expect(() => new SupabaseRidesRealtime().subscribeToPublicRideInserts({ onChange: vi.fn() })).not.toThrow();
  });
});
