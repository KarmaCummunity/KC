import { describe, it, expect, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { invalidateMyProfilePostQueries } from '../invalidateMyProfilePostQueries';

describe('invalidateMyProfilePostQueries', () => {
  it('invalidates standard profile post queries when userId is undefined', () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const mockClient = { invalidateQueries } as unknown as QueryClient;

    invalidateMyProfilePostQueries(mockClient, undefined);

    expect(invalidateQueries).toHaveBeenCalledTimes(5);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['my-posts'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['my-hidden-open-posts'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['profile-closed-posts'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['profile-tab-open-count'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['profile-tab-closed-count'] });
  });

  it('also invalidates user-profile cache when userId is provided', () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const mockClient = { invalidateQueries } as unknown as QueryClient;

    invalidateMyProfilePostQueries(mockClient, 'user-xyz');

    expect(invalidateQueries).toHaveBeenCalledTimes(6);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['user-profile', 'user-xyz'] });
  });
});
