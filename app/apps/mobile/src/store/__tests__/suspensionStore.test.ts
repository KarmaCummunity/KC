import { describe, it, expect, beforeEach } from 'vitest';
import { useSuspensionStore } from '../suspensionStore';

beforeEach(() => {
  // Reset between tests so ordering never leaks state.
  useSuspensionStore.getState().setSuspension(null);
});

describe('useSuspensionStore', () => {
  it('starts with no suspension', () => {
    expect(useSuspensionStore.getState().suspension).toBeNull();
  });

  it('stores a suspension with a reason and an end date', () => {
    const suspension = { reason: 'spam', until: '2026-12-01T00:00:00Z' };
    useSuspensionStore.getState().setSuspension(suspension);
    expect(useSuspensionStore.getState().suspension).toEqual(suspension);
  });

  it('keeps an open-ended suspension (until = null) and clears it on null', () => {
    useSuspensionStore.getState().setSuspension({ reason: 'abuse', until: null });
    expect(useSuspensionStore.getState().suspension?.until).toBeNull();

    useSuspensionStore.getState().setSuspension(null);
    expect(useSuspensionStore.getState().suspension).toBeNull();
  });
});
