import { describe, expect, it } from 'vitest';
import { shellNavigationRailVisible, shellTabBarHiddenForSegments } from '../shellChromePolicy';

describe('shellChromePolicy', () => {
  it('hides the tab bar only on chat conversation threads', () => {
    expect(shellTabBarHiddenForSegments(['chat'])).toBe(false);
    expect(shellTabBarHiddenForSegments(['chat', '[id]'])).toBe(true);
  });

  it('hides the tab bar on auth callback surfaces', () => {
    expect(shellTabBarHiddenForSegments(['auth', 'callback'])).toBe(true);
  });
});

describe('shellNavigationRailVisible (desktop rail, KC#2381)', () => {
  const member = { isLoading: false, isAuthenticated: true };
  const visitor = { isLoading: false, isAuthenticated: false };

  it('shows the rail to a signed-in member on member routes', () => {
    expect(shellNavigationRailVisible({ ...member, segments: ['(tabs)'] })).toBe(true);
    expect(shellNavigationRailVisible({ ...member, segments: ['settings'] })).toBe(true);
    expect(shellNavigationRailVisible({ ...member, segments: [] })).toBe(true);
  });

  it('keeps the rail on a chat thread, where only the floating tab bar is in the way', () => {
    expect(shellTabBarHiddenForSegments(['chat', '[id]'])).toBe(true);
    expect(shellNavigationRailVisible({ ...member, segments: ['chat', '[id]'] })).toBe(true);
  });

  it.each([[['(auth)']], [['about']], [['legal', 'terms']], [['research', '[slug]']], [[]]])(
    'hides the rail from a signed-out visitor on %j',
    (segments) => {
      expect(shellNavigationRailVisible({ ...visitor, segments })).toBe(false);
    },
  );

  it('hides the rail while the session is still being restored', () => {
    expect(shellNavigationRailVisible({ isLoading: true, isAuthenticated: true, segments: ['(tabs)'] })).toBe(false);
  });

  it.each([[['(auth)', 'sign-in']], [['(onboarding)', 'basic-info']], [['research', 'thanks']], [['auth', 'callback']], [['auth', 'verify']]])(
    'hides the rail from a signed-in member on the navigation-free surface %j',
    (segments) => {
      expect(shellNavigationRailVisible({ ...member, segments })).toBe(false);
    },
  );
});
