// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';

const router = vi.hoisted(() => ({
  canGoBack: vi.fn(() => true),
  back: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('expo-router', () => ({ useRouter: () => router }));

import { SilentUnauthorizedFallback } from '../SilentUnauthorizedFallback';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  router.canGoBack.mockReturnValue(true);
});

describe('SilentUnauthorizedFallback', () => {
  it('goes back when the stack can, and never shows a no-permission message', () => {
    const { getByTestId } = render(<SilentUnauthorizedFallback />);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    expect(getByTestId('silent-unauthorized-fallback')).toBeTruthy();
    expect(document.body.textContent ?? '').not.toMatch(/permission|forbidden|הרשאה/i);
  });

  it('replaces to the tabs when the stack cannot go back', () => {
    router.canGoBack.mockReturnValue(false);
    render(<SilentUnauthorizedFallback />);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/(tabs)');
  });

  it('replaces to the admin portal when that href is set and the stack is empty', () => {
    router.canGoBack.mockReturnValue(false);
    render(<SilentUnauthorizedFallback href="/(admin)" />);
    expect(router.replace).toHaveBeenCalledWith('/(admin)');
  });
});
