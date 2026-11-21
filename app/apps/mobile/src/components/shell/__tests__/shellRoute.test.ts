// #1768 — the shell reads a route by where a segment sits in the trail, never by a segment that
// merely appears somewhere in it (FR-RESP-001 / FR-RESP-002).
import { describe, expect, it } from 'vitest';
import { resolveShellVariant, routeHead } from '../shellRoute';
import { isTabActive, resolveActiveTabKey, TABS } from '../tabs.config';

const tab = (key: string) => TABS.find((t) => t.key === key)!;

describe('routeHead', () => {
  it('is the first segment that is not a route group', () => {
    expect(routeHead(['(tabs)', 'profile', 'closed'])).toBe('profile');
    expect(routeHead(['settings', 'organizations'])).toBe('settings');
    expect(routeHead(['(tabs)'])).toBeUndefined();
    expect(routeHead([])).toBeUndefined();
  });
});

describe('resolveShellVariant', () => {
  it('is narrow on the form-style routes and on the sign-in and onboarding groups', () => {
    for (const trail of [
      ['settings'], ['settings', 'organizations'], ['edit-profile'], ['edit-post', '[id]'],
      ['edit-listing', '[id]'], ['create'], ['(auth)', 'sign-in'], ['(onboarding)', 'basic-info'],
      ['auth', 'verify'], ['auth', 'callback'],
    ]) {
      expect(resolveShellVariant(trail), trail.join('/')).toBe('narrow');
    }
  });

  it('is wide everywhere else, including the rest of the bare auth routes', () => {
    for (const trail of [[], ['(tabs)'], ['(tabs)', 'profile'], ['post', '[id]'], ['auth', 'reset-password']]) {
      expect(resolveShellVariant(trail), trail.join('/')).toBe('wide');
    }
  });

  it('is not fooled by a form-style name deeper in another route', () => {
    expect(resolveShellVariant(['post', '[id]', 'settings'])).toBe('wide');
    expect(resolveShellVariant(['(tabs)', 'donations', 'create'])).toBe('wide');
    expect(resolveShellVariant(['org', '[id]', 'auth', 'verify'])).toBe('wide');
  });
});

describe('tab resolution by the head of the trail', () => {
  it('keeps one active tab when a tab name appears deeper in another tab', () => {
    const trail = ['(tabs)', 'donations', 'search'];
    expect(resolveActiveTabKey(trail)).toBe('donations');
    expect(isTabActive(tab('donations'), trail)).toBe(true);
    expect(isTabActive(tab('search'), trail)).toBe(false);
  });

  it('does not put a route outside the tabs on a tab because of a deeper segment', () => {
    expect(resolveActiveTabKey(['user', '[handle]', 'profile'])).toBeNull();
    expect(isTabActive(tab('profile'), ['user', '[handle]', 'profile'])).toBe(false);
    expect(resolveActiveTabKey(['post', '[id]', 'index'])).toBeNull();
  });
});
