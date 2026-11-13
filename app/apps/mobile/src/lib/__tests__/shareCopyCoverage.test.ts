// Every kind a post can have must have real copy in both locales: a missing key would show up in
// WhatsApp as the raw key, which no unit test with an echoing `t` can see.
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line no-restricted-imports -- test asserts every share key exists in the Hebrew bundle
import he from '../../i18n/locales/he';
// eslint-disable-next-line no-restricted-imports -- test asserts every share key exists in the English bundle
import en from '../../i18n/locales/en';
import { buildPostShareMessage } from '../buildPostShareMessage';
import { SHARE_WORLDS, type ShareDirection, type ShareLifecycle } from '../postShareKind';

type Bundle = Record<string, unknown>;

/** Resolves a dotted key against a locale bundle; returns the key itself when it is missing. */
function translator(bundle: Bundle) {
  return (key: string, params?: Record<string, string>): string => {
    const found = key.split('.').reduce<unknown>((node, part) => (node as Bundle | undefined)?.[part], bundle);
    if (typeof found !== 'string') return `MISSING:${key}`;
    return found.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => params?.[name] ?? '');
  };
}

const DIRECTIONS: ShareDirection[] = ['offer', 'request'];
const LIFECYCLES: ShareLifecycle[] = ['open', 'closed'];

describe.each([
  ['he', he],
  ['en', en],
])('share copy (%s)', (_name, bundle) => {
  const t = translator(bundle as Bundle);

  it.each(SHARE_WORLDS.flatMap((world) => DIRECTIONS.flatMap((direction) => LIFECYCLES.map((lifecycle) => ({ world, direction, lifecycle })))))(
    'composes a complete message for $world / $direction / $lifecycle',
    (kind) => {
      const msg = buildPostShareMessage(
        {
          kind,
          title: 'Title',
          description: 'Details',
          category: 'Furniture',
          address: { cityName: 'City', street: 'Street', streetNumber: '1' },
          locationDisplayLevel: 'CityOnly',
          postedAt: 'recently',
          publisherLabel: 'Dana',
          counterpartyLabel: 'Yossi',
        },
        t,
      );
      expect(msg).not.toContain('MISSING:');
      expect(msg).not.toContain('{{');
    },
  );

  it('gives every world a different headline per direction', () => {
    for (const world of SHARE_WORLDS) {
      expect(t(`share.post.headline.${world}.offer.open`)).not.toBe(t(`share.post.headline.${world}.request.open`));
    }
  });
});
