// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const track = vi.fn();
const trackCoreLoop = vi.fn();
const hapticSuccess = vi.fn();
const alertSpy = vi.spyOn(globalThis, 'alert').mockImplementation(() => {});

vi.mock('../../../../lib/analytics', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../../../lib/analyticsCoreLoop', () => ({ trackCoreLoop: (...args: unknown[]) => trackCoreLoop(...args) }));
vi.mock('../../../../lib/haptics', () => ({ hapticLightImpact: () => undefined, hapticSuccess: () => hapticSuccess() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('../../../../services/ridesFeedComposition', () => ({
  RIDES_FEED_QUERY_KEY: ['rides-feed'],
}));
vi.mock('../../../../services/rideBookingComposition', () => ({
  rideBookingsQueryKey: (id: string) => ['ride-bookings', id],
}));

import { useRideBookingAction } from '../useRideBookingAction';

afterEach(() => {
  vi.clearAllMocks();
});

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useRideBookingAction', () => {
  it('runs action, tracks analytics, fires haptic and invalidates all related queries on success', async () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useRideBookingAction('l_ride_123', 'c_tlv'), {
      wrapper: createWrapper(queryClient),
    });

    const action = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      await result.current.run(action, 'match_made');
    });

    expect(action).toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('match_made', { world: 'rides' });
    expect(hapticSuccess).toHaveBeenCalled();

    // Verify all 7 cache keys are invalidated
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['giving-handoff', 'l_ride_123'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['ride-bookings', 'l_ride_123'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['marketplace-detail', 'l_ride_123'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['marketplace'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['marketplace-browse'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['rides-feed'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['giving-handoffs'] });
  });

  it('tracks handover_completed on trip completion', async () => {
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useRideBookingAction('l_ride_123', 'c_tlv'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.run(async () => {}, 'handover_completed');
    });

    expect(trackCoreLoop).toHaveBeenCalledWith('handover_completed', { world: 'rides', cityId: 'c_tlv' });
  });

  it('catches errors and alerts with mapped error key', async () => {
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useRideBookingAction('l_ride_123', 'c_tlv'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.run(async () => {
        throw new Error('seats_exhausted');
      });
    });

    expect(alertSpy).toHaveBeenCalledWith('marketplace.errors.seats_exhausted');
    expect(result.current.busy).toBe(false);
  });
});
