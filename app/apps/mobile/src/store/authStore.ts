import { create } from 'zustand';
import type { AuthSession } from '@kc/application';
import type { OnboardingState } from '@kc/domain';

interface AuthState {
  session: AuthSession | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** FR-AUTH-007 AC2: drives AuthGate routing to (onboarding) vs (tabs). */
  onboardingState: OnboardingState | null;
  /**
   * FR-AUTH-010 — from users.basic_info_skipped; null until bootstrap fetch after sign-in.
   * When true with pending_basic_info, AuthGate routes to the feed (soft gate still applies).
   */
  basicInfoSkipped: boolean | null;
  setSession: (session: AuthSession | null) => void;
  setLoading: (loading: boolean) => void;
  setOnboardingState: (state: OnboardingState | null) => void;
  setBasicInfoSkipped: (value: boolean | null) => void;
  signOut: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  isLoading: true,
  isAuthenticated: false,
  onboardingState: null,
  basicInfoSkipped: null,
  setSession: (session) =>
    set({
      session,
      isAuthenticated: session !== null,
      isLoading: false,
      basicInfoSkipped: null,
      // Signing out forgets the onboarding step; a new session reads it again at bootstrap.
      ...(session === null ? { onboardingState: null } : {}),
    }),
  setLoading: (isLoading) => set({ isLoading }),
  setOnboardingState: (onboardingState) => set({ onboardingState }),
  setBasicInfoSkipped: (basicInfoSkipped) => set({ basicInfoSkipped }),
  signOut: () =>
    set({
      session: null,
      isAuthenticated: false,
      isLoading: false,
          onboardingState: null,
      basicInfoSkipped: null,
    }),
}));
