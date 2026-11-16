import { beforeEach, describe, expect, it } from 'vitest';
import { onboardingExitHref, useOnboardingReplayStore } from '../onboardingReplayStore';

beforeEach(() => useOnboardingReplayStore.getState().stop());

describe('useOnboardingReplayStore', () => {
  it('is off by default, with no preview photo', () => {
    expect(useOnboardingReplayStore.getState()).toMatchObject({ active: false, avatarPreviewUri: null });
  });

  it('keeps the picked photo for the running replay only', () => {
    const store = useOnboardingReplayStore.getState();
    store.start();
    store.setAvatarPreview('file://picked.jpg');
    expect(useOnboardingReplayStore.getState()).toMatchObject({ active: true, avatarPreviewUri: 'file://picked.jpg' });
    store.stop();
    expect(useOnboardingReplayStore.getState()).toMatchObject({ active: false, avatarPreviewUri: null });
  });

  it('starts every replay from a clean slate, so it can be repeated', () => {
    const store = useOnboardingReplayStore.getState();
    store.start();
    store.setAvatarPreview('file://first.jpg');
    store.start();
    expect(useOnboardingReplayStore.getState()).toMatchObject({ active: true, avatarPreviewUri: null });
  });

  it('ends a replay in the admin portal and a real onboarding in the app', () => {
    expect(onboardingExitHref(true)).toBe('/(admin)');
    expect(onboardingExitHref(false)).toBe('/(tabs)');
  });
});
