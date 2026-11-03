import { describe, it, expect } from 'vitest';
import {
  buildKcSupportOptions,
  hasKcSupportOptions,
  isKcSupportChannelKind,
  isSecureSupportUrl,
  type KcSupportChannel,
} from '../KcSupportChannel';

const channel = (overrides: Partial<KcSupportChannel> = {}): KcSupportChannel => ({
  kind: 'bit',
  url: 'https://www.bitpay.co.il/app/share-info?i=1',
  providerLabel: 'Bit',
  ...overrides,
});

describe('isSecureSupportUrl', () => {
  it.each([
    'https://www.bitpay.co.il/app/share-info?i=192485429007_19nlt4Un',
    'https://links.payboxapp.com/XR2JbQRxMUb',
    'https://pay.grow.link/abc?x=1#top',
    'https://pay.example.com:8443',
  ])('accepts %s', (url) => {
    expect(isSecureSupportUrl(url)).toBe(true);
  });

  it.each([
    'http://pay.example.com/x',
    'javascript:alert(1)',
    'https://user:pass@pay.example.com/x',
    'https://pay.example.com/a b',
    'https://',
    '',
  ])('rejects %s', (url) => {
    expect(isSecureSupportUrl(url)).toBe(false);
  });
});

describe('isKcSupportChannelKind', () => {
  it('recognises the four known kinds only', () => {
    expect(isKcSupportChannelKind('card_standing_order')).toBe(true);
    expect(isKcSupportChannelKind('bank_transfer')).toBe(false);
  });
});

describe('buildKcSupportOptions', () => {
  it('orders interim transfer links bit → paybox and separates the standing order', () => {
    const options = buildKcSupportOptions([
      channel({ kind: 'card_standing_order', url: 'https://pay.grow.link/monthly', providerLabel: 'Grow' }),
      channel({ kind: 'paybox', url: 'https://links.payboxapp.com/x', providerLabel: 'PayBox' }),
      channel(),
    ]);
    expect(options.oneTime.map((c) => c.kind)).toEqual(['bit', 'paybox']);
    expect(options.standingOrder?.url).toBe('https://pay.grow.link/monthly');
  });

  it('withdraws Bit / PayBox once a one-time clearing page exists (D64)', () => {
    const options = buildKcSupportOptions([
      channel(),
      channel({ kind: 'paybox', url: 'https://links.payboxapp.com/x', providerLabel: 'PayBox' }),
      channel({ kind: 'card_one_time', url: 'https://pay.grow.link/once', providerLabel: 'Grow' }),
    ]);
    expect(options.oneTime.map((c) => c.kind)).toEqual(['card_one_time']);
  });

  it('keeps Bit / PayBox when only a standing-order page exists', () => {
    const options = buildKcSupportOptions([
      channel(),
      channel({ kind: 'card_standing_order', url: 'https://pay.grow.link/monthly', providerLabel: 'Grow' }),
    ]);
    expect(options.oneTime.map((c) => c.kind)).toEqual(['bit']);
  });

  it('ignores an insecure clearing row when deciding to withdraw Bit / PayBox', () => {
    const options = buildKcSupportOptions([
      channel(),
      channel({ kind: 'card_one_time', url: 'http://insecure.example/once' }),
    ]);
    expect(options.oneTime.map((c) => c.kind)).toEqual(['bit']);
  });

  it('drops channels with insecure URLs and keeps the first row per kind', () => {
    const options = buildKcSupportOptions([
      channel({ url: 'http://insecure.example/bit' }),
      channel({ url: 'https://first.example/bit' }),
      channel({ url: 'https://second.example/bit' }),
      channel({ kind: 'card_standing_order', url: 'javascript:alert(1)' }),
    ]);
    expect(options.oneTime).toEqual([channel({ url: 'https://first.example/bit' })]);
    expect(options.standingOrder).toBeNull();
  });

  it('returns empty options for no channels', () => {
    const options = buildKcSupportOptions([]);
    expect(options).toEqual({ oneTime: [], standingOrder: null });
    expect(hasKcSupportOptions(options)).toBe(false);
  });

  it('reports options when only a standing order exists', () => {
    const options = buildKcSupportOptions([
      channel({ kind: 'card_standing_order', url: 'https://pay.grow.link/monthly' }),
    ]);
    expect(hasKcSupportOptions(options)).toBe(true);
  });
});
