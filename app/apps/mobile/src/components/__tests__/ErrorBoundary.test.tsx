// @vitest-environment jsdom
// Root ErrorBoundary tests (TD-33, KC#1410).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useState } from 'react';
import { Text } from '@kc/ui';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

const captureException = vi.fn();
vi.mock('../../lib/observability/sentry', () => ({ getSentryIfInit: () => ({ captureException }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('react-native-reanimated', async () => (await import('../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('@expo/vector-icons', async () => (await import('../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

function CrashingComponent({ crash }: { crash: boolean }) {
  if (crash) {
    throw new Error('Fatal render error');
  }
  return <Text testID="root-child">Normal Root Child</Text>;
}

function RootHarness() {
  const [crash, setCrash] = useState(true);
  return (
    <ErrorBoundary onReset={() => setCrash(false)}>
      <CrashingComponent crash={crash} />
    </ErrorBoundary>
  );
}

describe('ErrorBoundary (KC#1410)', () => {
  beforeEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    captureException.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders children when no error occurs', () => {
    const { getByTestId } = render(
      <ErrorBoundary>
        <Text testID="peaceful-child">All good</Text>
      </ErrorBoundary>,
    );
    expect(getByTestId('peaceful-child')).toBeTruthy();
  });

  it('catches render error, reports with root boundary tag, and recovers on retry', () => {
    const { getByText, getByTestId, queryByTestId, queryByText } = render(<RootHarness />);

    expect(queryByTestId('root-child')).toBeNull();
    expect(getByText('errorBoundary.title')).toBeTruthy();
    expect(getByText('errorBoundary.body')).toBeTruthy();

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Fatal render error' }),
      expect.objectContaining({
        tags: expect.objectContaining({ boundary: 'root' }),
      }),
    );

    fireEvent.click(getByTestId('error-boundary-retry'));

    expect(getByTestId('root-child')).toBeTruthy();
    expect(queryByText('errorBoundary.title')).toBeNull();
  });
});
