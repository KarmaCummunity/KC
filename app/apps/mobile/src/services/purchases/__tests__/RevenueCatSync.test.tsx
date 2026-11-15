// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sync, paymentsOn, session } = vi.hoisted(() => ({
  sync: vi.fn(async () => {}),
  paymentsOn: { value: false },
  session: { userId: 'u1' as string | null },
}));
vi.mock('../revenuecat', () => ({ syncRevenueCatUser: sync }));
vi.mock('../../../hooks/useLaunchSurface', () => ({ useLaunchSurface: () => paymentsOn.value }));
vi.mock('../../../store/authStore', () => ({
  useAuthStore: (select: (s: { session: { userId: string } | null }) => unknown) =>
    select({ session: session.userId ? { userId: session.userId } : null }),
}));

import { RevenueCatSync } from '../RevenueCatSync';

beforeEach(() => {
  vi.clearAllMocks();
  session.userId = 'u1';
});
afterEach(cleanup);

describe('RevenueCatSync and the payments launch surface', () => {
  it('does not touch RevenueCat while payments are off', () => {
    paymentsOn.value = false;
    render(<RevenueCatSync />);
    expect(sync).not.toHaveBeenCalled();
  });

  it('syncs the signed-in user once payments are on', () => {
    paymentsOn.value = true;
    render(<RevenueCatSync />);
    expect(sync).toHaveBeenCalledWith('u1');
  });

  it('configures on the next render when payments are switched on later', () => {
    paymentsOn.value = false;
    const { rerender } = render(<RevenueCatSync />);
    expect(sync).not.toHaveBeenCalled();
    paymentsOn.value = true;
    rerender(<RevenueCatSync />);
    expect(sync).toHaveBeenCalledWith('u1');
  });
});
