import { describe, expect, it } from 'vitest';
import { isSignedOutSurface } from '../signedOutSurfaces';

describe('isSignedOutSurface', () => {
  it('keeps the sign-in group and its return routes open', () => {
    expect(isSignedOutSurface(['(auth)'], '/')).toBe(true);
    expect(isSignedOutSurface(['(auth)', 'sign-in'], '/sign-in')).toBe(true);
    expect(isSignedOutSurface(['auth', 'callback'], '/auth/callback')).toBe(true);
    expect(isSignedOutSurface(['auth', 'verify'], '/auth/verify')).toBe(true);
    expect(isSignedOutSurface(['auth', 'reset-password'], '/auth/reset-password')).toBe(true);
  });

  it('keeps the surfaces that are public by decision open', () => {
    expect(isSignedOutSurface(['account-blocked'], '/account-blocked')).toBe(true);
    expect(isSignedOutSurface(['about'], '/about')).toBe(true);
    expect(isSignedOutSurface(['about-site'], '/about-site')).toBe(true);
    expect(isSignedOutSurface(['research'], '/research')).toBe(true);
    expect(isSignedOutSurface(['legal', 'terms'], '/legal/terms')).toBe(true);
    expect(
      isSignedOutSurface(['donations', 'money', 'nonprofit', '[id]'], '/donations/money/nonprofit/abc'),
    ).toBe(true);
  });

  // Regression (KC#2241): the guest preview group was removed with the 2026-11-10 decision "no
  // guest feed", so a stale link to it must be sent to sign-in like any other member route.
  it('does not treat the removed guest preview as a signed-out surface', () => {
    expect(isSignedOutSurface(['(guest)', 'feed'], '/feed')).toBe(false);
  });

  it('closes member routes and unknown auth sub-routes', () => {
    expect(isSignedOutSurface(['(tabs)'], '/')).toBe(false);
    expect(isSignedOutSurface(['post', '[id]'], '/post/123')).toBe(false);
    expect(isSignedOutSurface(['auth', 'unknown'], '/auth/unknown')).toBe(false);
    expect(isSignedOutSurface([], '/')).toBe(false);
  });
});
