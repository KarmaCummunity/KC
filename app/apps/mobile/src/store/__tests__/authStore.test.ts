import { describe, it, expect, beforeEach } from 'vitest';
import type { AuthSession } from '@kc/application';
import { useAuthStore } from '../authStore';

const session = { userId: 'u1' } as AuthSession;
const initial = useAuthStore.getState();

beforeEach(() => useAuthStore.setState(initial, true));

describe('useAuthStore', () => {
  it('starts loading and signed out', () => {
    expect(useAuthStore.getState()).toMatchObject({
      session: null,
      isLoading: true,
      isAuthenticated: false,
      onboardingState: null,
      basicInfoSkipped: null,
    });
  });

  it('a session signs in and resets the basic-info flag', () => {
    const s = useAuthStore.getState();
    s.setBasicInfoSkipped(true);
    s.setOnboardingState('completed');
    s.setSession(session);
    expect(useAuthStore.getState()).toMatchObject({
      session,
      isAuthenticated: true,
      isLoading: false,
      basicInfoSkipped: null,
      onboardingState: 'completed',
    });
  });

  it('a null session clears the onboarding state', () => {
    const s = useAuthStore.getState();
    s.setOnboardingState('completed');
    s.setSession(null);
    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: false,
      isLoading: false,
      onboardingState: null,
    });
  });

  it('setters update their own field only', () => {
    const s = useAuthStore.getState();
    s.setLoading(false);
    s.setBasicInfoSkipped(false);
    expect(useAuthStore.getState()).toMatchObject({ isLoading: false, basicInfoSkipped: false, session: null });
  });

  it('signOut resets everything', () => {
    const s = useAuthStore.getState();
    s.setSession(session);
    s.setOnboardingState('completed');
    s.signOut();
    expect(useAuthStore.getState()).toMatchObject({
      session: null,
      isAuthenticated: false,
      isLoading: false,
      onboardingState: null,
      basicInfoSkipped: null,
    });
  });
});
