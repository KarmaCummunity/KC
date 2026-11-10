import { describe, expect, it } from 'vitest';
import {
  WORLD_AFFINITY_HALF_LIFE_DAYS,
  orderWorldsByAffinity,
  parseWorldAffinity,
  recordWorldVisit,
  worldAffinityScore,
} from '../worldAffinity';

const DAY = 86_400_000;
const T0 = 1_800_000_000_000;

type Tile = { key: string; portal: boolean };
const tiles: Tile[] = [
  { key: 'items', portal: false },
  { key: 'money', portal: true },
  { key: 'food', portal: false },
  { key: 'medical', portal: true },
  { key: 'rides', portal: false },
];
const order = (affinity: Parameters<typeof orderWorldsByAffinity>[3], now = T0) =>
  orderWorldsByAffinity(tiles, (t) => t.key, (t) => t.portal, affinity, now).map((t) => t.key);

describe('worldAffinityScore', () => {
  it('halves after one half-life and is 0 for an unknown world', () => {
    expect(worldAffinityScore({ score: 4, at: T0 }, T0 + WORLD_AFFINITY_HALF_LIFE_DAYS * DAY)).toBeCloseTo(2);
    expect(worldAffinityScore(undefined, T0)).toBe(0);
  });

  it('never grows for a timestamp in the future', () => {
    expect(worldAffinityScore({ score: 3, at: T0 + DAY }, T0)).toBe(3);
  });
});

describe('recordWorldVisit', () => {
  it('adds one visit on top of the decayed score', () => {
    const once = recordWorldVisit({}, 'food', T0);
    const twice = recordWorldVisit(once, 'food', T0 + WORLD_AFFINITY_HALF_LIFE_DAYS * DAY);
    expect(twice.food).toEqual({ score: 1.5, at: T0 + WORLD_AFFINITY_HALF_LIFE_DAYS * DAY });
  });
});

describe('orderWorldsByAffinity', () => {
  it('puts active worlds first and keeps the canonical order without history', () => {
    expect(order({})).toEqual(['items', 'food', 'rides', 'money', 'medical']);
  });

  it('ranks each group by score, never lifting a portal above an active world', () => {
    let a = recordWorldVisit({}, 'rides', T0);
    a = recordWorldVisit(a, 'rides', T0);
    a = recordWorldVisit(a, 'medical', T0);
    a = recordWorldVisit(a, 'medical', T0);
    a = recordWorldVisit(a, 'medical', T0);
    expect(order(a)).toEqual(['rides', 'items', 'food', 'medical', 'money']);
  });

  it('lets a recent habit overtake an old one', () => {
    let a = recordWorldVisit({}, 'items', T0);
    a = recordWorldVisit(a, 'items', T0);
    a = recordWorldVisit(a, 'items', T0);
    const later = T0 + 60 * DAY;
    a = recordWorldVisit(a, 'food', later);
    expect(order(a, later).slice(0, 2)).toEqual(['food', 'items']);
  });
});

describe('parseWorldAffinity', () => {
  it('keeps valid entries and drops malformed ones', () => {
    expect(parseWorldAffinity({ food: { score: 2, at: T0 }, bad: { score: 'x' }, nul: null })).toEqual({
      food: { score: 2, at: T0 },
    });
    expect(parseWorldAffinity('nope')).toEqual({});
  });
});
