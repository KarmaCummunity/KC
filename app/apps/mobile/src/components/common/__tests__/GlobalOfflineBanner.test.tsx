// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GlobalOfflineBanner } from '../GlobalOfflineBanner';
import { useNetworkStatusStore } from '../../../lib/networkStatusStore';

vi.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'offlineSync.banner' ? 'No internet connection — working offline' : key),
  }),
}));

describe('GlobalOfflineBanner', () => {
  beforeEach(() => {
    useNetworkStatusStore.setState({ isOnline: true, isInternetReachable: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when online', () => {
    render(<GlobalOfflineBanner />);
    expect(screen.queryByTestId('global-offline-banner')).toBeNull();
  });

  it('renders the banner when offline', () => {
    useNetworkStatusStore.setState({ isOnline: false, isInternetReachable: false });
    render(<GlobalOfflineBanner />);
    expect(screen.getByTestId('global-offline-banner')).toBeTruthy();
    expect(screen.getByText('No internet connection — working offline')).toBeTruthy();
  });
});
