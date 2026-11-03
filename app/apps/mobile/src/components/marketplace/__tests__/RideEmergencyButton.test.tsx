// @vitest-environment jsdom
// G44 / D70 — the emergency call: only while the ride is under way, and only after a second tap.
// Both taps are the kit `AlertButton` (spec 17 §8.1 call 7).
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

const { raiseRideEmergency } = vi.hoisted(() => ({ raiseRideEmergency: vi.fn() }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
// The kit buttons pull in reanimated and haptics; their press feedback is not under test here.
vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../../../services/rideSafetyComposition', () => ({ raiseRideEmergency }));

import { RideEmergencyButton } from '../rides/RideEmergencyButton';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

/** A ride that left `minutesAgo` minutes ago and ends an hour after departure. */
const ride = (minutesAgo: number) => {
  const departs = new Date(Date.now() - minutesAgo * 60_000);
  return { departs_at: departs.toISOString(), arrives_at: new Date(departs.getTime() + 3_600_000).toISOString() };
};

function renderButton(details: Record<string, unknown>) {
  return render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <RideEmergencyButton listingId="l1" details={details} />
    </ThemeProvider>,
  );
}

describe('RideEmergencyButton', () => {
  it('is hidden before the ride is under way', () => {
    expect(renderButton(ride(-180)).queryByTestId('ride-emergency')).toBeNull();
  });

  it('sends only after the second tap', async () => {
    raiseRideEmergency.mockResolvedValue(undefined);
    vi.spyOn(globalThis, 'alert').mockImplementation(() => {});
    const view = renderButton(ride(10));

    // Each tap is a kit button named by its label and carrying the alert glyph.
    fireEvent.click(view.getByRole('button', { name: 'rideSafety.emergency' }));
    expect(raiseRideEmergency).not.toHaveBeenCalled();
    expect(view.getAllByTestId('icon-alert-circle-outline')).toHaveLength(1);
    expect(view.getByRole('button', { name: 'rideSafety.emergencyCancel' })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'rideSafety.emergencySend' }));
    await waitFor(() => expect(raiseRideEmergency).toHaveBeenCalledWith('l1'));
  });

  it('can be cancelled at the confirm step', () => {
    const view = renderButton(ride(10));
    fireEvent.click(view.getByTestId('ride-emergency'));
    fireEvent.click(view.getByTestId('ride-emergency-cancel'));
    expect(view.queryByTestId('ride-emergency')).not.toBeNull();
    expect(raiseRideEmergency).not.toHaveBeenCalled();
  });

  it('shows the server reason when the call is refused', async () => {
    raiseRideEmergency.mockRejectedValue(new Error('emergency_throttled'));
    const alertSpy = vi.spyOn(globalThis, 'alert').mockImplementation(() => {});
    const view = renderButton(ride(10));
    fireEvent.click(view.getByTestId('ride-emergency'));
    fireEvent.click(view.getByTestId('ride-emergency-send'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('marketplace.errors.emergency_throttled'));
  });
});
