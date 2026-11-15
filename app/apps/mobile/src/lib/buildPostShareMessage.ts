// FR-POST-023 — composes the localized message body that accompanies the share URL. Pure (no React,
// no i18next side effects) so tests do not bootstrap the i18n runtime. The caller appends the URL
// on its own trailing line; keeping it out of here lets `shareLink` pass it structurally on Web
// while embedding it inline on native, without duplicating this composer per platform.
//
// The wording follows the post's kind (world × direction × lifecycle, see postShareKind.ts), and so
// does the set of fields: an item has a category, a ride has a route, and a category means nothing
// for the other worlds. Labels are wrapped in `*…*` so WhatsApp, Telegram and Signal render them bold.
//
//   <headline — kind>
//
//   *<publisher>* <name|anonymous>
//   *<counterparty>* <name|anonymous>   <-- closed post with a marked recipient only
//   *<title | route>* <title>
//   *<description>* <description>       <-- omitted when empty
//   *<category>* <category>             <-- items only
//   *<location>* <address>              <-- city / city+street / full per locationDisplayLevel
//   *<postedAt>* <relative time>
//   *<status>* <open|closed>
//
//   <CTA — kind>

import type { LocationDisplayLevel } from '@kc/domain';
import type { PostShareKind, ShareWorld } from './postShareKind';

const DESCRIPTION_MAX = 200;

export interface PostShareMessageInput {
  readonly kind: PostShareKind;
  readonly title: string;
  readonly description: string | null;
  /** Item category enum value (e.g. `Furniture`, `Other`); shown for the items world only. */
  readonly category: string;
  readonly address: { cityName: string; street: string; streetNumber: string };
  readonly locationDisplayLevel: LocationDisplayLevel;
  /** Already-formatted relative time, e.g. "2 days ago". */
  readonly postedAt: string;
  /** Resolved owner line (name, deleted fallback, or anonymous). */
  readonly publisherLabel: string;
  /** Resolved counterparty when closed + marked recipient; omit for open posts. */
  readonly counterpartyLabel?: string | null;
}

export type ShareTranslate = (key: string, params?: Record<string, string>) => string;

type FieldId = 'title' | 'description' | 'category' | 'location' | 'postedAt' | 'status';

/**
 * The fields after the publisher line, per world. A ride's title already is its route and its
 * address is only the departure city, so it shows neither category nor location; every other
 * non-item world drops the item category, which says nothing about a lesson or a stay.
 */
const FIELDS: Record<ShareWorld, readonly FieldId[]> = {
  items: ['title', 'description', 'category', 'location', 'postedAt', 'status'],
  rides: ['title', 'description', 'postedAt', 'status'],
  food: ['title', 'description', 'location', 'postedAt', 'status'],
  time: ['title', 'description', 'location', 'postedAt', 'status'],
  housing: ['title', 'description', 'location', 'postedAt', 'status'],
  animals: ['title', 'description', 'location', 'postedAt', 'status'],
  knowledge: ['title', 'description', 'location', 'postedAt', 'status'],
  challenges: ['title', 'description', 'location', 'postedAt', 'status'],
  generic: ['title', 'description', 'location', 'postedAt', 'status'],
};

function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max - 1).trimEnd()}…`;
}

function bold(label: string, value: string): string {
  return `*${label}* ${value}`;
}

function renderAddress(input: PostShareMessageInput, t: ShareTranslate): string {
  const city = input.address.cityName.trim();
  if (input.locationDisplayLevel === 'CityOnly') return city;
  if (input.locationDisplayLevel === 'CityAndStreet') {
    return `${city}, ${t('post.detail.streetPrefix')} ${input.address.street.trim()}`;
  }
  return `${city}, ${input.address.street.trim()} ${input.address.streetNumber.trim()}`;
}

/** The line for one field, or null when the post has nothing to say for it. */
function renderField(field: FieldId, input: PostShareMessageInput, t: ShareTranslate): string | null {
  const label = (key: string) => t(`share.post.label.${key}`);
  switch (field) {
    case 'title': {
      const key = input.kind.world === 'rides' ? 'route' : 'title';
      return bold(label(key), input.title.trim());
    }
    case 'description': {
      const description = (input.description ?? '').trim();
      return description === '' ? null : bold(label('description'), truncate(description, DESCRIPTION_MAX));
    }
    case 'category':
      return bold(label('category'), t(`post.category.${input.category}`));
    case 'location': {
      const address = renderAddress(input, t);
      return address === '' ? null : bold(label('location'), address);
    }
    case 'postedAt':
      return bold(label('postedAt'), input.postedAt);
    case 'status':
      return bold(label('status'), t(input.kind.lifecycle === 'closed' ? 'post.detail.statusClosed' : 'post.detail.statusOpen'));
  }
}

function renderCta(kind: PostShareKind, t: ShareTranslate): string {
  return kind.lifecycle === 'closed' ? t('share.post.ctaClosed') : t(`share.post.cta.${kind.world}.${kind.direction}`);
}

export function buildPostShareMessage(post: PostShareMessageInput, t: ShareTranslate): string {
  const { kind } = post;
  const lines: string[] = [t(`share.post.headline.${kind.world}.${kind.direction}.${kind.lifecycle}`), ''];
  lines.push(bold(t('share.post.label.publisher'), post.publisherLabel));

  const counterparty = (post.counterpartyLabel ?? '').trim();
  if (kind.lifecycle === 'closed' && counterparty !== '') {
    lines.push(bold(t('share.post.label.counterparty'), counterparty));
  }

  for (const field of FIELDS[kind.world]) {
    const line = renderField(field, post, t);
    if (line !== null) lines.push(line);
  }

  lines.push('', renderCta(kind, t));
  return lines.join('\n');
}
