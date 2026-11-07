// Re-tap rule for the bottom bar / rail (#1633): the active tab never pushes a duplicate.
import { describe, expect, it, vi } from 'vitest';
import { TABS, type TabKey } from '../tabs.config';
import { handleActiveTabRepress, resolveTabPressAction } from '../tabPress';

const tabOf = (key: TabKey) => {
  const tab = TABS.find((candidate) => candidate.key === key);
  if (!tab) throw new Error(`missing tab ${key}`);
  return tab;
};

describe('resolveTabPressAction', () => {
  it('stays on every tab root when that tab is re-tapped', () => {
    expect(resolveTabPressAction(tabOf('home'), ['(tabs)'])).toBe('stay');
    expect(resolveTabPressAction(tabOf('home'), ['(tabs)', 'index'])).toBe('stay');
    expect(resolveTabPressAction(tabOf('home'), [])).toBe('stay');
    expect(resolveTabPressAction(tabOf('donations'), ['(tabs)', 'donations'])).toBe('stay');
    expect(resolveTabPressAction(tabOf('donations'), ['(tabs)', 'donations', 'index'])).toBe('stay');
    expect(resolveTabPressAction(tabOf('profile'), ['(tabs)', 'profile'])).toBe('stay');
    expect(resolveTabPressAction(tabOf('search'), ['(tabs)', 'search'])).toBe('stay');
  });

  it('closes the create form when the composer "+" is re-tapped while it is open', () => {
    expect(resolveTabPressAction(tabOf('create'), ['(tabs)', 'create'])).toBe('close');
  });

  it('stays on flat web segment trails without the (tabs) group', () => {
    expect(resolveTabPressAction(tabOf('profile'), ['profile'])).toBe('stay');
    expect(resolveTabPressAction(tabOf('donations'), ['donations'])).toBe('stay');
  });

  it('unwinds to the tab root when a nested screen of the active tab is on top', () => {
    expect(resolveTabPressAction(tabOf('donations'), ['(tabs)', 'donations', 'rides'])).toBe('popToRoot');
    expect(resolveTabPressAction(tabOf('donations'), ['(tabs)', 'donations', 'category', '[slug]'])).toBe(
      'popToRoot',
    );
    expect(resolveTabPressAction(tabOf('profile'), ['(tabs)', 'profile', 'saved'])).toBe('popToRoot');
  });

  it('opens a tab that is not the active one', () => {
    expect(resolveTabPressAction(tabOf('profile'), ['(tabs)', 'donations'])).toBe('open');
    expect(resolveTabPressAction(tabOf('home'), ['(tabs)', 'profile'])).toBe('open');
    expect(resolveTabPressAction(tabOf('donations'), ['(tabs)'])).toBe('open');
  });

  it('opens the tab from root-level screens shown over the tabs', () => {
    expect(resolveTabPressAction(tabOf('home'), ['post', '[id]'])).toBe('open');
    expect(resolveTabPressAction(tabOf('profile'), ['settings'])).toBe('open');
  });
});

describe('handleActiveTabRepress', () => {
  it('keeps the active tab root mounted: handled, no navigation', () => {
    const router = { dismissTo: vi.fn(), back: vi.fn(), canGoBack: vi.fn(() => true) };
    expect(handleActiveTabRepress(router, tabOf('donations'), ['(tabs)', 'donations'])).toBe(true);
    expect(router.dismissTo).not.toHaveBeenCalled();
  });

  it('dismisses back to the tab root from a nested screen', () => {
    const router = { dismissTo: vi.fn(), back: vi.fn(), canGoBack: vi.fn(() => true) };
    expect(handleActiveTabRepress(router, tabOf('donations'), ['(tabs)', 'donations', 'food'])).toBe(true);
    expect(router.dismissTo).toHaveBeenCalledWith('/(tabs)/donations');
  });

  it('closes the open create form by going back', () => {
    const router = { dismissTo: vi.fn(), back: vi.fn(), canGoBack: vi.fn(() => true) };
    expect(handleActiveTabRepress(router, tabOf('create'), ['(tabs)', 'create'])).toBe(true);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.dismissTo).not.toHaveBeenCalled();
  });

  it('falls back to home when the create form has nothing to go back to', () => {
    const router = { dismissTo: vi.fn(), back: vi.fn(), canGoBack: vi.fn(() => false) };
    expect(handleActiveTabRepress(router, tabOf('create'), ['(tabs)', 'create'])).toBe(true);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.dismissTo).toHaveBeenCalledWith('/(tabs)');
  });

  it('leaves switching to another tab to the caller', () => {
    const router = { dismissTo: vi.fn(), back: vi.fn(), canGoBack: vi.fn(() => true) };
    expect(handleActiveTabRepress(router, tabOf('profile'), ['(tabs)', 'donations'])).toBe(false);
    expect(router.dismissTo).not.toHaveBeenCalled();
  });
});
