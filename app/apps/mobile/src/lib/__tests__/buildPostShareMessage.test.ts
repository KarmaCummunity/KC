import { describe, expect, it } from 'vitest';
import { buildPostShareMessage, type PostShareMessageInput, type ShareTranslate } from '../buildPostShareMessage';
import type { PostShareKind } from '../postShareKind';

const t: ShareTranslate = (key) => `t:${key}`;

const ITEM_OPEN: PostShareKind = { world: 'items', direction: 'offer', lifecycle: 'open' };

function base(overrides: Partial<PostShareMessageInput> = {}): PostShareMessageInput {
  return {
    kind: ITEM_OPEN,
    title: 'שולחן עץ',
    description: 'שולחן יד-שנייה במצב מצוין',
    category: 'Furniture',
    address: { cityName: 'תל אביב', street: 'דיזנגוף', streetNumber: '99' },
    locationDisplayLevel: 'CityOnly',
    postedAt: 'לפני יומיים',
    publisherLabel: 'דנה',
    ...overrides,
  };
}

const withKind = (patch: Partial<PostShareKind>, rest: Partial<PostShareMessageInput> = {}) =>
  base({ kind: { ...ITEM_OPEN, ...patch }, ...rest });

describe('buildPostShareMessage — wording follows the kind', () => {
  it('opens with the headline of the post world, direction and lifecycle, and ends with its CTA', () => {
    const msg = buildPostShareMessage(withKind({ world: 'rides', direction: 'request' }), t);
    expect(msg.startsWith('t:share.post.headline.rides.request.open')).toBe(true);
    expect(msg.endsWith('t:share.post.cta.rides.request')).toBe(true);
  });

  it('never leaks the item wording into another world', () => {
    const msg = buildPostShareMessage(withKind({ world: 'rides' }), t);
    expect(msg).not.toContain('items');
  });

  it('uses the closed headline and the shared closed CTA once the post is closed', () => {
    const msg = buildPostShareMessage(withKind({ world: 'food', lifecycle: 'closed' }), t);
    expect(msg.startsWith('t:share.post.headline.food.offer.closed')).toBe(true);
    expect(msg.endsWith('t:share.post.ctaClosed')).toBe(true);
  });

  it('shows the lifecycle in the status line', () => {
    expect(buildPostShareMessage(base(), t)).toContain('*t:share.post.label.status* t:post.detail.statusOpen');
    expect(buildPostShareMessage(withKind({ lifecycle: 'closed' }), t)).toContain(
      '*t:share.post.label.status* t:post.detail.statusClosed',
    );
  });
});

describe('buildPostShareMessage — fields per world', () => {
  it('shows the item category only for items, even for Other', () => {
    expect(buildPostShareMessage(base({ category: 'Other' }), t)).toContain(
      '*t:share.post.label.category* t:post.category.Other',
    );
    for (const world of ['food', 'rides', 'time', 'housing', 'animals', 'knowledge', 'challenges', 'generic'] as const) {
      expect(buildPostShareMessage(withKind({ world }), t)).not.toContain('label.category');
    }
  });

  it('labels a ride title as its route and leaves out the departure-city location', () => {
    const msg = buildPostShareMessage(withKind({ world: 'rides' }, { title: 'נוסע/ת מירושלים להוד השרון' }), t);
    expect(msg).toContain('*t:share.post.label.route* נוסע/ת מירושלים להוד השרון');
    expect(msg).not.toContain('label.location');
    expect(msg).not.toContain('label.title');
  });

  it('labels every other title as a title and keeps the location', () => {
    const msg = buildPostShareMessage(withKind({ world: 'housing' }), t);
    expect(msg).toContain('*t:share.post.label.title* שולחן עץ');
    expect(msg).toContain('*t:share.post.label.location* תל אביב');
  });

  it('wraps every label in bold asterisks', () => {
    const msg = buildPostShareMessage(base(), t);
    expect(msg).toContain('*t:share.post.label.description* שולחן יד-שנייה במצב מצוין');
    expect(msg).toContain('*t:share.post.label.postedAt* לפני יומיים');
  });
});

describe('buildPostShareMessage — description', () => {
  it('omits the line when the description is null, empty or blank', () => {
    for (const description of [null, '', '   ']) {
      expect(buildPostShareMessage(base({ description }), t)).not.toContain('label.description');
    }
  });

  it('truncates a description longer than 200 characters with an ellipsis', () => {
    const msg = buildPostShareMessage(base({ description: 'א'.repeat(250) }), t);
    const line = msg.split('\n').find((l) => l.includes('label.description')) ?? '';
    expect(line.endsWith('…')).toBe(true);
    expect(line.length).toBeLessThanOrEqual('*t:share.post.label.description* '.length + 200);
  });
});

describe('buildPostShareMessage — location privacy', () => {
  it('renders the city only for CityOnly', () => {
    const msg = buildPostShareMessage(base({ locationDisplayLevel: 'CityOnly' }), t);
    expect(msg).toContain('*t:share.post.label.location* תל אביב');
    expect(msg).not.toContain('דיזנגוף');
    expect(msg).not.toContain('99');
  });

  it('renders city and street for CityAndStreet, without the number', () => {
    const msg = buildPostShareMessage(base({ locationDisplayLevel: 'CityAndStreet' }), t);
    expect(msg).toContain('תל אביב, t:post.detail.streetPrefix דיזנגוף');
    expect(msg).not.toContain('99');
  });

  it('renders the full address for FullAddress', () => {
    expect(buildPostShareMessage(base({ locationDisplayLevel: 'FullAddress' }), t)).toContain('תל אביב, דיזנגוף 99');
  });
});

describe('buildPostShareMessage — people', () => {
  it('always shows the publisher, including the anonymous label', () => {
    expect(buildPostShareMessage(base({ publisherLabel: 'דנה' }), t)).toContain('*t:share.post.label.publisher* דנה');
    expect(buildPostShareMessage(base({ publisherLabel: 't:post.detail.anonymousUser' }), t)).toContain(
      '*t:share.post.label.publisher* t:post.detail.anonymousUser',
    );
  });

  it('shows the counterparty only on a closed post with a label', () => {
    expect(buildPostShareMessage(base({ counterpartyLabel: 'יוסי' }), t)).not.toContain('label.counterparty');
    expect(buildPostShareMessage(withKind({ lifecycle: 'closed' }, { counterpartyLabel: 'יוסי' }), t)).toContain(
      '*t:share.post.label.counterparty* יוסי',
    );
    expect(buildPostShareMessage(withKind({ lifecycle: 'closed' }, { counterpartyLabel: '  ' }), t)).not.toContain(
      'label.counterparty',
    );
  });
});
