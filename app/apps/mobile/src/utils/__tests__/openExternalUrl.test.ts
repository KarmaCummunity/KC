import { describe, it, expect, vi, afterEach } from 'vitest';

const { platform, browser } = vi.hoisted(() => ({
  platform: { OS: 'ios' as string },
  browser: { openBrowserAsync: vi.fn(async () => ({ type: 'opened' })) },
}));

vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('expo-web-browser', () => browser);

import { openExternalUrl } from '../openExternalUrl';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  platform.OS = 'ios';
});

describe('openExternalUrl', () => {
  it('opens a named window on web', () => {
    platform.OS = 'web';
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    openExternalUrl(' https://example.com/a ');
    expect(open).toHaveBeenCalledWith('https://example.com/a', '_kc_external');
    expect(browser.openBrowserAsync).not.toHaveBeenCalled();
  });

  it('falls back to the in-app browser on web without a window', () => {
    platform.OS = 'web';
    vi.stubGlobal('window', undefined);
    openExternalUrl('https://example.com/');
    expect(browser.openBrowserAsync).toHaveBeenCalledWith('https://example.com/');
  });

  it('uses the in-app browser on native', () => {
    openExternalUrl('mailto:team@example.com');
    expect(browser.openBrowserAsync).toHaveBeenCalledWith('mailto:team@example.com');
  });

  it('refuses unsafe schemes before opening anything', () => {
    expect(() => openExternalUrl('javascript:alert(1)')).toThrow('unsupported_scheme');
    expect(browser.openBrowserAsync).not.toHaveBeenCalled();
  });
});
