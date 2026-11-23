import { beforeEach, describe, expect, it } from 'vitest';
import { REDIRECT_INTENT_TTL_MS, isRestorablePath, useRedirectIntentStore } from '../redirectIntentStore';

describe('isRestorablePath', () => {
  it('accepts /post/, /edit-post/, /edit-listing/, /user/, /chat/ paths', () => {
    expect(isRestorablePath('/post/abc-123')).toBe(true);
    expect(isRestorablePath('/edit-post/abc-123')).toBe(true);
    expect(isRestorablePath('/edit-listing/abc-123')).toBe(true);
    expect(isRestorablePath('/user/handle')).toBe(true);
    expect(isRestorablePath('/chat/thread-1')).toBe(true);
  });

  it('rejects auth, onboarding, tabs paths', () => {
    expect(isRestorablePath('/(auth)/sign-in')).toBe(false);
    expect(isRestorablePath('/(onboarding)/photo')).toBe(false);
    expect(isRestorablePath('/(tabs)')).toBe(false);
    expect(isRestorablePath('/')).toBe(false);
    expect(isRestorablePath('')).toBe(false);
  });
});

describe('redirectIntentStore', () => {
  beforeEach(() => {
    useRedirectIntentStore.getState().clearPath();
  });

  it('captures a restorable path', () => {
    useRedirectIntentStore.getState().capturePath('/post/abc');
    expect(useRedirectIntentStore.getState().pendingPath).toBe('/post/abc');
  });

  it('ignores non-restorable paths', () => {
    useRedirectIntentStore.getState().capturePath('/(auth)/sign-in');
    expect(useRedirectIntentStore.getState().pendingPath).toBeNull();
  });

  it('consumePath returns the path and clears it', () => {
    useRedirectIntentStore.getState().capturePath('/post/abc');
    const out = useRedirectIntentStore.getState().consumePath();
    expect(out).toBe('/post/abc');
    expect(useRedirectIntentStore.getState().pendingPath).toBeNull();
  });

  it('consumePath returns null past the TTL', () => {
    const now = 1_000_000;
    useRedirectIntentStore.getState().capturePath('/post/abc', now);
    const out = useRedirectIntentStore.getState().consumePath(now + REDIRECT_INTENT_TTL_MS + 1);
    expect(out).toBeNull();
    expect(useRedirectIntentStore.getState().pendingPath).toBeNull();
  });

  it('capturing the same path twice is a no-op', () => {
    useRedirectIntentStore.getState().capturePath('/post/abc', 1000);
    useRedirectIntentStore.getState().capturePath('/post/abc', 9999);
    expect(useRedirectIntentStore.getState().capturedAtMs).toBe(1000);
  });

  it('clearPath wipes the pending intent', () => {
    useRedirectIntentStore.getState().capturePath('/post/abc');
    useRedirectIntentStore.getState().clearPath();
    expect(useRedirectIntentStore.getState().pendingPath).toBeNull();
  });
});
