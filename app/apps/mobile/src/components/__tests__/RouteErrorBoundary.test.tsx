// @vitest-environment jsdom
// A render error inside one route segment shows a recoverable fallback for that
// segment only (the shell and tab bar stay up), is reported to Sentry with the
// route, and "retry" re-renders the segment. Audit P1-8 (§4.3).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { RouteErrorBoundary } from '../RouteErrorBoundary';

const captureException = vi.fn();
vi.mock('../../lib/observability/sentry', () => ({ getSentryIfInit: () => ({ captureException }) }));
vi.mock('expo-router', () => ({ usePathname: () => '/chat/abc' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
// The retry is a kit button, which pulls in reanimated and haptics; its press feedback is not under test here.
vi.mock('react-native-reanimated', async () => (await import('../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('@expo/vector-icons', async () => (await import('../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

describe('RouteErrorBoundary', () => {
  beforeEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    captureException.mockClear();
  });
  afterEach(cleanup);

  it('renders the fallback and reports the error with its route', () => {
    const error = new Error('boom');
    const { getByText } = render(<RouteErrorBoundary error={error} retry={vi.fn()} />);
    expect(getByText('errorBoundary.title')).toBeTruthy();
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error, expect.objectContaining({ tags: { boundary: 'route', route: '/chat/abc' } }));
  });

  it('retries the segment when the user taps retry', () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    const { getByText } = render(<RouteErrorBoundary error={new Error('boom')} retry={retry} />);
    fireEvent.click(getByText('general.retry'));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
