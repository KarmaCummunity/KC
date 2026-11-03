// @vitest-environment jsdom
// Ride sheets on the kit `BottomSheet` (FR-RIDE-002, FR-RIDE-041, spec 17 §4.1.1, TD-243):
// each renders its content and actions and dismisses through `onClose`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

vi.mock('react-native-reanimated', async () => {
  const { View } = await vi.importActual<typeof import('react-native')>('react-native');
  return {
    default: { View },
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: () => ({}),
    withSpring: (value: number) => value,
    withTiming: (value: number) => value,
  };
});
vi.mock('expo-haptics', () => ({ impactAsync: () => Promise.resolve(), ImpactFeedbackStyle: { Light: 'light' } }));
vi.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('../../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../../../../hooks/useModalHardwareBack', () => ({ useModalHardwareBack: () => {} }));
vi.mock('../../../../components/CityPicker', () => ({ CityPicker: () => <span data-testid="city-picker" /> }));
vi.mock('../../../../components/DonationLinksList', () => ({
  DonationLinksList: ({ categorySlug }: { categorySlug: string }) => <span data-testid={`links-${categorySlug}`} />,
}));
const acceptDeclaration = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../../composition/ridesComposition', () => ({
  getAcceptDriverDeclarationUseCase: () => ({ execute: acceptDeclaration }),
}));

import { DriverDeclarationSheet } from '../DriverDeclarationSheet';
import { RideFilterSheet } from '../RideFilterSheet';
import { RideTransportLinksSheet } from '../RideTransportLinksSheet';
import { useRidesFilterStore } from '../../store/ridesFilterStore';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const withTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>{ui}</ThemeProvider>);

describe('DriverDeclarationSheet', () => {
  it('accepts only once all three declarations are ticked, then closes', async () => {
    const onClose = vi.fn();
    const onAccepted = vi.fn();
    const { getByRole, getAllByRole } = withTheme(
      <DriverDeclarationSheet visible onClose={onClose} onAccepted={onAccepted} />,
    );
    expect(getByRole('heading').textContent).toBe('donations.rides.declaration.title');
    const accept = getByRole('button', { name: 'donations.rides.declaration.accept' });
    expect(accept.getAttribute('aria-disabled')).toBe('true');
    for (const row of getAllByRole('checkbox')) fireEvent.click(row);
    fireEvent.click(accept);
    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1));
    expect(acceptDeclaration).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses through onClose without accepting', () => {
    const onClose = vi.fn();
    const { getByRole } = withTheme(<DriverDeclarationSheet visible onClose={onClose} onAccepted={vi.fn()} />);
    fireEvent.click(getByRole('button', { name: 'general.close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(acceptDeclaration).not.toHaveBeenCalled();
  });
});

describe('RideFilterSheet', () => {
  it('applies the chosen ride mode, then closes', () => {
    useRidesFilterStore.getState().clearFilters();
    const onClose = vi.fn();
    const { getByRole } = withTheme(<RideFilterSheet visible onClose={onClose} />);
    expect(getByRole('heading').textContent).toBe('donations.rides.filtersTitle');
    // Compact filter chips (D99): 28pt tall, 44pt touch target via `hitSlop`.
    expect(getComputedStyle(getByRole('checkbox', { name: 'donations.rides.modeOffer' })).minHeight).toBe('28px');
    fireEvent.click(getByRole('checkbox', { name: 'donations.rides.modeOffer' }));
    fireEvent.click(getByRole('button', { name: 'donations.rides.applyFilters' }));
    expect(useRidesFilterStore.getState().mode).toBe('offer');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clears the filters and closes from the footer action', () => {
    useRidesFilterStore.getState().setMode('request');
    const onClose = vi.fn();
    const { getByRole } = withTheme(<RideFilterSheet visible onClose={onClose} />);
    fireEvent.click(getByRole('button', { name: 'donations.rides.clearFilters' }));
    expect(useRidesFilterStore.getState().mode).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses through onClose without applying', () => {
    useRidesFilterStore.getState().clearFilters();
    const onClose = vi.fn();
    const { getByRole } = withTheme(<RideFilterSheet visible onClose={onClose} />);
    fireEvent.click(getByRole('checkbox', { name: 'donations.rides.modeRequest' }));
    fireEvent.click(getByRole('button', { name: 'general.close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useRidesFilterStore.getState().mode).toBeNull();
  });
});

describe('RideTransportLinksSheet', () => {
  it('lists the transport links under its title and dismisses through onClose', () => {
    const onClose = vi.fn();
    const { getByRole, getByTestId, getByText } = withTheme(<RideTransportLinksSheet visible onClose={onClose} />);
    expect(getByRole('heading').textContent).toBe('donations.rides.linksSheetTitle');
    expect(getByText('donations.rides.linksSheetSubtitle')).toBeTruthy();
    expect(getByTestId('links-transport')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'general.close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
