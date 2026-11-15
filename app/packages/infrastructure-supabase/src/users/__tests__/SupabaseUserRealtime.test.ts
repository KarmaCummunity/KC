import { describe, it, expect, vi } from 'vitest';
import { flush, makeFakeRealtime } from '../../realtime/__tests__/fakeRealtime';
import { SupabaseUserRealtime, parseAccountChange } from '../SupabaseUserRealtime';

describe('parseAccountChange', () => {
  it('reads the broadcast payload (status, suspension end, onboarding state)', () => {
    expect(
      parseAccountChange({ status: 'suspended_admin', status_until: '2026-12-01T00:00:00Z', onboarding_state: 'completed' }),
    ).toEqual({ status: 'suspended_admin', statusUntil: '2026-12-01T00:00:00Z', onboardingState: 'completed' });
  });

  it('reads an unlimited sanction as statusUntil null', () => {
    expect(parseAccountChange({ status: 'banned', status_until: null, onboarding_state: 'completed' })?.statusUntil).toBeNull();
  });

  it.each([[null], [{}], [{ status: 'active' }], [{ onboarding_state: 'completed' }], ['active']])(
    'rejects a payload without a status and an onboarding state: %j',
    (payload) => {
      expect(parseAccountChange(payload)).toBeNull();
    },
  );
});

describe('SupabaseUserRealtime (FR-MOD-010 AC4)', () => {
  it('joins the private topic user:<id>:account and hands account_changed payloads to the listener', async () => {
    const f = makeFakeRealtime();
    const onChange = vi.fn();

    const unsubscribe = new SupabaseUserRealtime(f.client).subscribeToAccount('u1', onChange);
    await flush();

    expect(f.channel).toHaveBeenCalledWith('user:u1:account', { config: { private: true } });
    expect(f.setAuth).toHaveBeenCalledTimes(1);
    f.created[0]!.emit('broadcast', 'account_changed', {
      payload: { status: 'banned', status_until: null, onboarding_state: 'completed' },
    });
    expect(onChange).toHaveBeenCalledWith({ status: 'banned', statusUntil: null, onboardingState: 'completed' });

    unsubscribe();
    expect(f.created[0]!.removed).toBe(true);
  });

  it('ignores events of another name and malformed payloads', async () => {
    const f = makeFakeRealtime();
    const onChange = vi.fn();
    new SupabaseUserRealtime(f.client).subscribeToAccount('u1', onChange);
    await flush();

    f.created[0]!.emit('broadcast', 'badge', { payload: { unread_count: 3 } });
    f.created[0]!.emit('broadcast', 'account_changed', { payload: { status: 'active' } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports CHANNEL_ERROR / TIMED_OUT through onError and stays silent on a healthy status', async () => {
    const f = makeFakeRealtime();
    const onError = vi.fn();
    new SupabaseUserRealtime(f.client).subscribeToAccount('u1', vi.fn(), onError);
    await flush();

    f.created[0]!.statusCb!('CHANNEL_ERROR');
    expect(onError).toHaveBeenCalledTimes(1);
    f.created[0]!.statusCb!('SUBSCRIBED');
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
