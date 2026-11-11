// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchFlags } = vi.hoisted(() => ({ fetchFlags: vi.fn() }));
vi.mock('../../services/featureFlagsComposition', () => ({ fetchRemoteFeatureFlags: fetchFlags }));

import { useLaunchSurface } from '../useLaunchSurface';

const ORIGINAL = process.env['EXPO_PUBLIC_ENVIRONMENT'];
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  if (ORIGINAL === undefined) delete process.env['EXPO_PUBLIC_ENVIRONMENT'];
  else process.env['EXPO_PUBLIC_ENVIRONMENT'] = ORIGINAL;
});

describe('useLaunchSurface', () => {
  it('is hidden in production while the flags load and when the fetch fails', async () => {
    process.env['EXPO_PUBLIC_ENVIRONMENT'] = 'production';
    fetchFlags.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useLaunchSurface('emailAuth'), { wrapper });
    expect(result.current).toBe(false);
    await waitFor(() => expect(fetchFlags).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('follows a remote app_flags row once it arrives, in production', async () => {
    process.env['EXPO_PUBLIC_ENVIRONMENT'] = 'production';
    fetchFlags.mockResolvedValue({ launch_email_auth_enabled: true });
    const { result } = renderHook(() => useLaunchSurface('emailAuth'), { wrapper });
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('is visible in development and a remote row can hide it', async () => {
    process.env['EXPO_PUBLIC_ENVIRONMENT'] = 'development';
    fetchFlags.mockResolvedValue({ launch_whatsapp_bot_enabled: false });
    const email = renderHook(() => useLaunchSurface('emailAuth'), { wrapper });
    const bot = renderHook(() => useLaunchSurface('whatsappBot'), { wrapper });
    expect(email.result.current).toBe(true);
    expect(bot.result.current).toBe(true);
    await waitFor(() => expect(bot.result.current).toBe(false));
    expect(email.result.current).toBe(true);
  });
});
