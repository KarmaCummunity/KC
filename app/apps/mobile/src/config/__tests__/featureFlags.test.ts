import { describe, expect, it } from 'vitest';
import {
  FEATURE_FLAG_DEFAULTS,
  buildExternalDonationUrl,
  resolveFeatureFlag,
  shouldOpenDonationsExternally,
} from '../featureFlags';

describe('featureFlags', () => {
  it('defaults ios_in_app_donations to off', () => {
    expect(FEATURE_FLAG_DEFAULTS.ios_in_app_donations).toBe(false);
    expect(resolveFeatureFlag('ios_in_app_donations', undefined)).toBe(false);
    expect(resolveFeatureFlag('ios_in_app_donations', {})).toBe(false);
  });

  it('keeps the sandbox in-app org payments flow hidden by default (FR-DONATE-011)', () => {
    expect(FEATURE_FLAG_DEFAULTS.money_in_app_org_payments).toBe(false);
    expect(resolveFeatureFlag('money_in_app_org_payments', {})).toBe(false);
    expect(resolveFeatureFlag('money_in_app_org_payments', { money_in_app_org_payments: true })).toBe(true);
  });

  it('remote row overrides the default', () => {
    expect(resolveFeatureFlag('ios_in_app_donations', { ios_in_app_donations: true })).toBe(true);
  });

  it('only iOS with the flag off goes external', () => {
    expect(shouldOpenDonationsExternally('ios', false)).toBe(true);
    expect(shouldOpenDonationsExternally('ios', true)).toBe(false);
    expect(shouldOpenDonationsExternally('android', false)).toBe(false);
    expect(shouldOpenDonationsExternally('web', false)).toBe(false);
  });

  it('builds web donation URLs', () => {
    expect(buildExternalDonationUrl('https://x.test/', 'donate', 'org 1')).toBe(
      'https://x.test/donations/money/donate/org%201',
    );
    expect(buildExternalDonationUrl('https://x.test', 'donate', 'o', 'l1')).toBe(
      'https://x.test/donations/money/donate/o?listingId=l1',
    );
    expect(buildExternalDonationUrl('https://x.test', 'standing-order', 'o', 'l1')).toBe(
      'https://x.test/donations/money/standing-order/o',
    );
  });
});
