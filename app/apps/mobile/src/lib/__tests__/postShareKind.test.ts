import { describe, expect, it } from 'vitest';
import { resolvePostShareKind, resolveShareWorld } from '../postShareKind';

const post = (patch: Record<string, unknown> = {}) =>
  ({ type: 'Give', status: 'open', listingWorldSlug: null, challengeId: null, ...patch }) as Parameters<typeof resolvePostShareKind>[0];

describe('resolveShareWorld', () => {
  it('treats a post without a world slug as an item post', () => {
    expect(resolveShareWorld(post())).toBe('items');
    expect(resolveShareWorld(post({ listingWorldSlug: 'items' }))).toBe('items');
  });

  it('maps every world with its own wording to itself', () => {
    for (const slug of ['food', 'rides', 'time', 'housing', 'animals', 'knowledge']) {
      expect(resolveShareWorld(post({ listingWorldSlug: slug }))).toBe(slug);
    }
  });

  it('falls back to the generic wording for worlds without their own', () => {
    for (const slug of ['money', 'medical', 'democracy', 'employment', 'unknown-world', 'generic']) {
      expect(resolveShareWorld(post({ listingWorldSlug: slug }))).toBe('generic');
    }
  });

  it('lets a challenge win over the world slug', () => {
    expect(resolveShareWorld(post({ challengeId: 'c1', listingWorldSlug: 'time' }))).toBe('challenges');
  });
});

describe('resolvePostShareKind', () => {
  it('maps Give to an offer and Request to a request', () => {
    expect(resolvePostShareKind(post({ type: 'Give' })).direction).toBe('offer');
    expect(resolvePostShareKind(post({ type: 'Request' })).direction).toBe('request');
  });

  it('maps closed_delivered to closed and every other status to open', () => {
    expect(resolvePostShareKind(post({ status: 'closed_delivered' })).lifecycle).toBe('closed');
    expect(resolvePostShareKind(post({ status: 'open' })).lifecycle).toBe('open');
  });

  it('reads a ride offer as the ride it is, not as an item', () => {
    expect(resolvePostShareKind(post({ listingWorldSlug: 'rides' }))).toEqual({
      world: 'rides',
      direction: 'offer',
      lifecycle: 'open',
    });
  });
});
