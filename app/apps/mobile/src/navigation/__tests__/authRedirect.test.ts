import { describe, expect, it } from 'vitest';
import { resolveAuthRedirect, type AuthRedirectInput } from '../authRedirect';

/** A signed-out visitor on the welcome screen with everything loaded; each test overrides what it needs. */
function input(overrides: Partial<AuthRedirectInput> = {}): AuthRedirectInput {
  return {
    navigationReady: true,
    isLoading: false,
    isAuthenticated: false,
    onboardingState: null,
    basicInfoSkipped: null,
    segments: ['(auth)'],
    pathname: '/',
    ...overrides,
  };
}

describe('resolveAuthRedirect', () => {
  // Regression (KC#2250, Sentry KC-9): after Android recreates the activity the auth store is
  // already loaded, so the gate decided in the first commit, before the root navigator existed.
  it('does nothing until the root navigator is ready', () => {
    expect(resolveAuthRedirect(input({ navigationReady: false, segments: [], pathname: '/' }))).toEqual({ kind: 'stay' });
    expect(
      resolveAuthRedirect(input({ navigationReady: false, isAuthenticated: true, onboardingState: 'completed' })),
    ).toEqual({ kind: 'stay' });
  });

  it('does nothing while the session is still being restored', () => {
    expect(resolveAuthRedirect(input({ isLoading: true, segments: ['(tabs)'], pathname: '/' }))).toEqual({ kind: 'stay' });
  });

  describe('signed out', () => {
    it('stays on a signed-out surface', () => {
      expect(resolveAuthRedirect(input())).toEqual({ kind: 'stay' });
      expect(resolveAuthRedirect(input({ segments: ['legal', 'terms'], pathname: '/legal/terms' }))).toEqual({ kind: 'stay' });
    });

    it('sends a member route to the welcome screen and remembers where the visitor was going', () => {
      expect(resolveAuthRedirect(input({ segments: ['post', '[id]'], pathname: '/post/42' }))).toEqual({
        kind: 'welcome',
        rememberPath: '/post/42',
      });
    });
  });

  describe('signed in', () => {
    const member = (overrides: Partial<AuthRedirectInput> = {}) =>
      input({ isAuthenticated: true, onboardingState: 'completed', ...overrides });

    it('stays put once past the entry routes, whatever the onboarding step', () => {
      expect(resolveAuthRedirect(member({ segments: ['(tabs)'], pathname: '/' }))).toEqual({ kind: 'stay' });
      expect(
        resolveAuthRedirect(member({ segments: ['(tabs)'], pathname: '/', onboardingState: 'pending_basic_info' })),
      ).toEqual({ kind: 'stay' });
    });

    it('waits on an entry route until the onboarding step is known', () => {
      expect(resolveAuthRedirect(member({ onboardingState: null }))).toEqual({ kind: 'stay' });
    });

    it('forwards a finished member from every entry route to the app', () => {
      expect(resolveAuthRedirect(member())).toEqual({ kind: 'home' });
      expect(resolveAuthRedirect(member({ segments: ['auth', 'callback'], pathname: '/auth/callback' }))).toEqual({ kind: 'home' });
      expect(resolveAuthRedirect(member({ segments: ['auth', 'verify'], pathname: '/auth/verify' }))).toEqual({ kind: 'home' });
    });

    it('keeps the password reset screen open for the recovery session', () => {
      expect(
        resolveAuthRedirect(member({ segments: ['auth', 'reset-password'], pathname: '/auth/reset-password' })),
      ).toEqual({ kind: 'stay' });
    });

    it('opens the onboarding step that is still pending', () => {
      expect(resolveAuthRedirect(member({ onboardingState: 'pending_basic_info' }))).toEqual({
        kind: 'onboarding',
        href: '/(onboarding)/about-intro',
      });
      expect(resolveAuthRedirect(member({ onboardingState: 'pending_avatar' }))).toEqual({
        kind: 'onboarding',
        href: '/(onboarding)/photo',
      });
    });

    it('lets a member who skipped the basic info into the app (FR-AUTH-010 AC3)', () => {
      expect(
        resolveAuthRedirect(member({ onboardingState: 'pending_basic_info', basicInfoSkipped: true })),
      ).toEqual({ kind: 'home' });
    });
  });
});
