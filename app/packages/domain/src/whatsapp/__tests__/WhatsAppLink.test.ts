import { describe, expect, it } from 'vitest';
import {
  canRequestWhatsAppLinkCode,
  canToggleWhatsAppMatchAlerts,
  isWhatsAppLinkCodeValid,
  isWhatsAppLinkError,
  WhatsAppLinkError,
  type WhatsAppLinkStatus,
} from '../WhatsAppLink';

const base: WhatsAppLinkStatus = {
  linked: false, waIdMasked: null, isPro: false, consentOptedIn: false, phoneOptedOut: false,
};

describe('WhatsApp link rules', () => {
  it('offers a link code to Pro members only (D143)', () => {
    expect(canRequestWhatsAppLinkCode(base)).toBe(false);
    expect(canRequestWhatsAppLinkCode({ ...base, isPro: true })).toBe(true);
  });

  it('offers the match-alert switch once a number is linked', () => {
    expect(canToggleWhatsAppMatchAlerts({ ...base, isPro: true })).toBe(false);
    expect(canToggleWhatsAppMatchAlerts({ ...base, linked: true })).toBe(true);
  });

  it('treats a code as valid until its expiry, exclusive', () => {
    const code = { code: '123456', expiresAt: new Date('2026-11-13T10:10:00Z') };
    expect(isWhatsAppLinkCodeValid(code, new Date('2026-11-13T10:09:59Z'))).toBe(true);
    expect(isWhatsAppLinkCodeValid(code, new Date('2026-11-13T10:10:00Z'))).toBe(false);
  });
});

describe('WhatsAppLinkError', () => {
  it('carries its code and narrows', () => {
    const e = new WhatsAppLinkError('pro_required');
    expect(e.message).toBe('pro_required');
    expect(e.name).toBe('WhatsAppLinkError');
    expect(isWhatsAppLinkError(e)).toBe(true);
    expect(isWhatsAppLinkError(new Error('pro_required'))).toBe(false);
  });
});
