// @vitest-environment jsdom
// Regression test (KC#1410): a component that throws inside a screen boundary
// renders the error screen and "Try again" recovers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useState } from 'react';
import { Text } from '@kc/ui';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ScreenErrorBoundary } from '../ScreenErrorBoundary';

const captureException = vi.fn();
vi.mock('../../lib/observability/sentry', () => ({ getSentryIfInit: () => ({ captureException }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('react-native-reanimated', async () => (await import('../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('@expo/vector-icons', async () => (await import('../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

function FlakyScreen({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Screen crashed unexpectedly');
  }
  return <Text testID="healthy-screen">Healthy Screen Loaded</Text>;
}

function TestHarness() {
  const [fail, setFail] = useState(true);
  return (
    <ScreenErrorBoundary name="flaky-screen" onReset={() => setFail(false)}>
      <FlakyScreen shouldThrow={fail} />
    </ScreenErrorBoundary>
  );
}

describe('ScreenErrorBoundary (KC#1410)', () => {
  beforeEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    captureException.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the error screen when a child throws, reports to Sentry, and "Try again" recovers', () => {
    const { getByText, getByTestId, queryByTestId, queryByText } = render(<TestHarness />);

    // Child component threw: normal content is unmounted
    expect(queryByTestId('healthy-screen')).toBeNull();

    // Friendly error screen is displayed
    expect(getByText('errorBoundary.title')).toBeTruthy();
    expect(getByText('errorBoundary.body')).toBeTruthy();
    const retryBtn = getByTestId('error-boundary-retry');
    expect(retryBtn).toBeTruthy();

    // Error is reported to Sentry with screen boundary tags
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Screen crashed unexpectedly' }),
      expect.objectContaining({
        tags: expect.objectContaining({ boundary: 'screen', screen: 'flaky-screen' }),
      }),
    );

    // Clicking "Try again" resets the boundary and recovers the healthy content
    fireEvent.click(retryBtn);

    expect(getByTestId('healthy-screen')).toBeTruthy();
    expect(getByText('Healthy Screen Loaded')).toBeTruthy();
    expect(queryByText('errorBoundary.title')).toBeNull();
  });
});
