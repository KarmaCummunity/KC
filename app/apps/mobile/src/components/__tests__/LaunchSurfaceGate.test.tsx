// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useLaunchSurface } = vi.hoisted(() => ({ useLaunchSurface: vi.fn() }));
vi.mock('../../hooks/useLaunchSurface', () => ({ useLaunchSurface }));
vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => <div data-testid="redirect">{href}</div>,
}));

import { LaunchSurfaceGate } from '../LaunchSurfaceGate';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('LaunchSurfaceGate', () => {
  it('renders the children while the surface is visible', () => {
    useLaunchSurface.mockReturnValue(true);
    render(
      <LaunchSurfaceGate surface="emailAuth" redirectTo="/(auth)">
        <span>sign-up form</span>
      </LaunchSurfaceGate>,
    );
    expect(screen.getByText('sign-up form')).toBeTruthy();
    expect(screen.queryByTestId('redirect')).toBeNull();
    expect(useLaunchSurface).toHaveBeenCalledWith('emailAuth');
  });

  it('redirects instead of rendering while the surface is hidden', () => {
    useLaunchSurface.mockReturnValue(false);
    render(
      <LaunchSurfaceGate surface="whatsappBot" redirectTo="/settings">
        <span>whatsapp link</span>
      </LaunchSurfaceGate>,
    );
    expect(screen.queryByText('whatsapp link')).toBeNull();
    expect(screen.getByTestId('redirect').textContent).toBe('/settings');
  });
});
