import { describe, expect, it } from 'vitest';
import {
  WhatsAppAdminError,
  canResolveWhatsAppReview,
  invalidWhatsAppSendLimitFields,
  isWhatsAppAdminError,
  isWhatsAppOutboundResendable,
  isWhatsAppTemplateMetaStatus,
  WHATSAPP_OUTBOUND_STATUSES,
  WHATSAPP_SEND_LIMIT_FIELDS,
} from '../WhatsAppAdminRules';

describe('WhatsAppAdminError', () => {
  it('defaults message to code and sets name', () => {
    const e = new WhatsAppAdminError('forbidden');
    expect(e.message).toBe('forbidden');
    expect(e.name).toBe('WhatsAppAdminError');
    expect(e.code).toBe('forbidden');
  });

  it('accepts an optional message', () => {
    expect(new WhatsAppAdminError('unknown', 'detail').message).toBe('detail');
  });

  it('isWhatsAppAdminError narrows only this class', () => {
    expect(isWhatsAppAdminError(new WhatsAppAdminError('outbound_not_found'))).toBe(true);
    expect(isWhatsAppAdminError(new Error('x'))).toBe(false);
    expect(isWhatsAppAdminError(null)).toBe(false);
  });
});

describe('outbound resend', () => {
  it('allows a failure and the capacity skips, as api_whatsapp_admin_resend does', () => {
    const resendable = WHATSAPP_OUTBOUND_STATUSES.filter(isWhatsAppOutboundResendable);
    expect(resendable).toEqual(['failed', 'skipped_rate_limit', 'skipped_outside_window', 'skipped_global_cap']);
  });

  it('never resends a consent skip or a sent message', () => {
    expect(isWhatsAppOutboundResendable('skipped_no_consent')).toBe(false);
    expect(isWhatsAppOutboundResendable('sent')).toBe(false);
    expect(isWhatsAppOutboundResendable('nonsense')).toBe(false);
  });
});

describe('review decisions', () => {
  it('decide a pending item only', () => {
    expect(canResolveWhatsAppReview('pending', 'approved')).toBe(true);
    expect(canResolveWhatsAppReview('pending', 'rejected')).toBe(true);
    expect(canResolveWhatsAppReview('approved', 'rejected')).toBe(false);
    expect(canResolveWhatsAppReview('rejected', 'rejected')).toBe(false);
    expect(canResolveWhatsAppReview('unknown', 'approved')).toBe(false);
  });
});

describe('template meta status', () => {
  it('accepts the six Meta states only', () => {
    expect(isWhatsAppTemplateMetaStatus('approved')).toBe(true);
    expect(isWhatsAppTemplateMetaStatus('deprecated')).toBe(true);
    expect(isWhatsAppTemplateMetaStatus('APPROVED')).toBe(false);
  });
});

describe('send limits patch', () => {
  it('lists the ten limits of the table', () => {
    expect(WHATSAPP_SEND_LIMIT_FIELDS).toHaveLength(10);
  });

  it('accepts whole numbers inside each range and an empty patch', () => {
    expect(invalidWhatsAppSendLimitFields({ perUserHour: 1, maxAttempts: 20, globalPerMinute: 100000 })).toEqual([]);
    expect(invalidWhatsAppSendLimitFields({})).toEqual([]);
  });

  it('names every field out of range or not whole', () => {
    expect(invalidWhatsAppSendLimitFields({ perUserHour: 0, maxAttempts: 21, backoffBaseSeconds: 2.5, llmGlobalDay: 10 }))
      .toEqual(['perUserHour', 'maxAttempts', 'backoffBaseSeconds']);
    expect(invalidWhatsAppSendLimitFields({ perUserDay: Number.NaN })).toEqual(['perUserDay']);
  });
});
