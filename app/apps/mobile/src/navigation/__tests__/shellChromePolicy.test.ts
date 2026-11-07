import { describe, expect, it } from 'vitest';
import { shellTabBarHiddenForSegments } from '../shellChromePolicy';

describe('shellChromePolicy', () => {
  it('hides the tab bar only on chat conversation threads', () => {
    expect(shellTabBarHiddenForSegments(['chat'])).toBe(false);
    expect(shellTabBarHiddenForSegments(['chat', '[id]'])).toBe(true);
  });

  it('hides the tab bar on auth callback surfaces', () => {
    expect(shellTabBarHiddenForSegments(['auth', 'callback'])).toBe(true);
  });
});
