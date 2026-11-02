// @vitest-environment jsdom
// KC#1410: the gate renders the app while no fatal error is stored, swaps in
// the recoverable fallback when the global handler stores one, and "retry"
// clears the error so the shell remounts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { UncaughtErrorGate } from '../UncaughtErrorGate';
import { useUncaughtErrorStore } from '../../store/uncaughtErrorStore';

vi.mock('../../lib/observability/sentry', () => ({ getSentryIfInit: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

describe('UncaughtErrorGate', () => {
  beforeEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    useUncaughtErrorStore.getState().clear();
  });
  afterEach(cleanup);

  it('renders its children while no error is stored', () => {
    const { getByText, queryByText } = render(
      <UncaughtErrorGate>
        <span>app shell</span>
      </UncaughtErrorGate>,
    );
    expect(getByText('app shell')).toBeTruthy();
    expect(queryByText('errorBoundary.title')).toBeNull();
  });

  it('shows the fallback once the global handler stores a fatal error, and retry restores the shell', () => {
    const { getByText, queryByText } = render(
      <UncaughtErrorGate>
        <span>app shell</span>
      </UncaughtErrorGate>,
    );

    React.act(() => useUncaughtErrorStore.getState().show(new Error('fatal')));
    expect(getByText('errorBoundary.title')).toBeTruthy();
    expect(queryByText('app shell')).toBeNull();

    fireEvent.click(getByText('general.retry'));
    expect(getByText('app shell')).toBeTruthy();
    expect(useUncaughtErrorStore.getState().error).toBeNull();
  });

  it('keeps the first fatal error when a second one arrives while the fallback is shown', () => {
    const first = new Error('first');
    useUncaughtErrorStore.getState().show(first);
    useUncaughtErrorStore.getState().show(new Error('second'));
    expect(useUncaughtErrorStore.getState().error).toBe(first);
  });
});
