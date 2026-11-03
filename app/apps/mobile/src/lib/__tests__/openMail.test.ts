import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Linking, Platform } from 'react-native';
import { resolveWebmailUrl, openMail } from '../openMail';

vi.mock('react-native', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-native');
  return {
    ...actual,
    Linking: {
      openURL: vi.fn(),
    },
  };
});

describe('resolveWebmailUrl', () => {
  it('routes gmail addresses to gmail.com', () => {
    expect(resolveWebmailUrl('alice@gmail.com')).toBe('https://mail.google.com/mail/u/0/#inbox');
  });

  it('routes googlemail.com to gmail.com', () => {
    expect(resolveWebmailUrl('alice@googlemail.com')).toBe('https://mail.google.com/mail/u/0/#inbox');
  });

  it('routes outlook / hotmail / live to outlook.live.com', () => {
    expect(resolveWebmailUrl('bob@outlook.com')).toBe('https://outlook.live.com/mail/');
    expect(resolveWebmailUrl('bob@hotmail.com')).toBe('https://outlook.live.com/mail/');
    expect(resolveWebmailUrl('bob@live.com')).toBe('https://outlook.live.com/mail/');
  });

  it('routes yahoo to mail.yahoo.com', () => {
    expect(resolveWebmailUrl('eve@yahoo.com')).toBe('https://mail.yahoo.com/');
  });

  it('falls back to mailto: for unknown providers', () => {
    expect(resolveWebmailUrl('user@example.com')).toBe('mailto:');
  });

  it('returns mailto: for malformed email', () => {
    expect(resolveWebmailUrl('no-at')).toBe('mailto:');
    expect(resolveWebmailUrl('')).toBe('mailto:');
  });

  it('is case-insensitive on the domain', () => {
    expect(resolveWebmailUrl('A@GMAIL.COM')).toBe('https://mail.google.com/mail/u/0/#inbox');
  });

  it('routes icloud, me, and mac domains to icloud mail', () => {
    expect(resolveWebmailUrl('carol@icloud.com')).toBe('https://www.icloud.com/mail');
    expect(resolveWebmailUrl('carol@me.com')).toBe('https://www.icloud.com/mail');
    expect(resolveWebmailUrl('carol@mac.com')).toBe('https://www.icloud.com/mail');
  });

  it('routes proton domains to proton mail', () => {
    expect(resolveWebmailUrl('dan@proton.me')).toBe('https://mail.proton.me/');
    expect(resolveWebmailUrl('dan@protonmail.com')).toBe('https://mail.proton.me/');
  });

  it('routes yahoo regional and alternate domains and msn', () => {
    expect(resolveWebmailUrl('eve@yahoo.co.uk')).toBe('https://mail.yahoo.com/');
    expect(resolveWebmailUrl('eve@ymail.com')).toBe('https://mail.yahoo.com/');
    expect(resolveWebmailUrl('bob@msn.com')).toBe('https://outlook.live.com/mail/');
  });

  it('returns mailto: when email ends with at sign', () => {
    expect(resolveWebmailUrl('user@')).toBe('mailto:');
  });
});

describe('openMail', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  it('opens webmail in a new browser tab on web platform', async () => {
    Platform.OS = 'web';
    const mockOpen = vi.fn();
    globalThis.window = { open: mockOpen } as unknown as Window & typeof globalThis;

    await openMail('alice@gmail.com');

    expect(mockOpen).toHaveBeenCalledWith(
      'https://mail.google.com/mail/u/0/#inbox',
      '_blank',
      'noopener,noreferrer',
    );
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('safely handles missing window on web', async () => {
    Platform.OS = 'web';
    // @ts-expect-error simulating non-browser
    delete globalThis.window;

    await expect(openMail('alice@gmail.com')).resolves.not.toThrow();
  });

  it('opens mailto URL on native platforms', async () => {
    Platform.OS = 'ios';

    await openMail('alice@gmail.com');

    expect(Linking.openURL).toHaveBeenCalledWith('mailto:');
  });
});
