// FR-AUTH-001 AC4, FR-AUTH-007 AC2, FR-AUTH-013 — pure AuthGate redirect decision (Sentry KC-9).
import { describe, expect, it } from 'vitest';
import { decideAuthRedirect, type AuthRedirectInput } from '../authRedirect';

const base: AuthRedirectInput = {
  navigationReady: true,
  isLoading: false,
  isAuthenticated: false,
  segments: ['(auth)'],
  pathname: '/',
  onboardingState: null,
  basicInfoSkipped: null,
};

describe('decideAuthRedirect', () => {
  it('does nothing before the root navigator is ready', () => {
    expect(decideAuthRedirect({ ...base, navigationReady: false, segments: [] })).toEqual({ kind: 'none' });
  });

  it('does nothing while the session is loading', () => {
    expect(decideAuthRedirect({ ...base, isLoading: true, segments: ['(tabs)'] })).toEqual({ kind: 'none' });
  });

  it('sends a signed-out visitor on a member route to welcome and remembers the path', () => {
    expect(decideAuthRedirect({ ...base, segments: ['(tabs)'], pathname: '/profile' })).toEqual({
      kind: 'replace',
      href: '/(auth)',
      rememberPath: '/profile',
    });
  });

  it('keeps a signed-out visitor on a signed-out surface', () => {
    expect(decideAuthRedirect({ ...base, segments: ['(auth)'] })).toEqual({ kind: 'none' });
  });

  it('sends a signed-in member on an entry route to the onboarding step', () => {
    const entry = { ...base, isAuthenticated: true };
    expect(decideAuthRedirect({ ...entry, onboardingState: 'pending_basic_info' })).toEqual({
      kind: 'replace',
      href: '/(onboarding)/about-intro',
    });
    expect(decideAuthRedirect({ ...entry, onboardingState: 'pending_avatar' })).toEqual({
      kind: 'replace',
      href: '/(onboarding)/photo',
    });
  });

  it('sends a signed-in member on an entry route to the tabs (or a pending deep link)', () => {
    const entry = { ...base, isAuthenticated: true, onboardingState: 'completed' as const };
    expect(decideAuthRedirect(entry)).toEqual({ kind: 'replace', href: null, usePendingPath: true });
    expect(
      decideAuthRedirect({ ...entry, onboardingState: 'pending_basic_info', basicInfoSkipped: true }),
    ).toEqual({ kind: 'replace', href: null, usePendingPath: true });
  });

  it('waits for the onboarding state on an entry route', () => {
    expect(decideAuthRedirect({ ...base, isAuthenticated: true })).toEqual({ kind: 'none' });
  });

  it('leaves a signed-in member elsewhere alone', () => {
    expect(
      decideAuthRedirect({ ...base, isAuthenticated: true, segments: ['(tabs)'], onboardingState: 'completed' }),
    ).toEqual({ kind: 'none' });
  });
});
