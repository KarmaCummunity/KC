import { describe, expect, it } from 'vitest';
import { ImportExtractionError } from '../ImportExtractionError';
import { validateExtraction, type ExtractionLists } from '../validateExtraction';

const lists: ExtractionLists = {
  worlds: ['items', 'food', 'rides'],
  subcategories: { items: ['furniture', 'books'], food: ['cooked'] },
  detailKeys: { items: ['condition', 'quantity'] },
};

const valid = {
  is_post: true,
  reject_reason: null,
  direction: 'offer',
  world_slug: 'items',
  subcategory: 'furniture',
  title: 'ספה תלת מושבית',
  description: 'במצב טוב, לאסוף עד חמישי',
  place: { city_text: 'תל אביב', street_text: null, neighborhood_text: 'נווה שאנן' },
  time: { kind: 'none' },
  ride: null,
  details: { condition: 'good', secret: 'x' },
  language: 'he',
  confidence: { overall: 0.9, per_field: { direction: 0.95, world: 0.9 } },
};

const fails = (raw: unknown, reason?: string) => {
  try {
    validateExtraction(raw, lists);
  } catch (e) {
    expect(e).toBeInstanceOf(ImportExtractionError);
    if (reason) expect((e as ImportExtractionError).reason).toBe(reason);
    return;
  }
  throw new Error('expected validateExtraction to throw');
};

describe('validateExtraction', () => {
  it('maps a valid contract object to the camelCase domain shape', () => {
    const out = validateExtraction(valid, lists);
    expect(out).toMatchObject({
      isPost: true, direction: 'offer', worldSlug: 'items', subcategory: 'furniture',
      title: 'ספה תלת מושבית', language: 'he',
      place: { cityText: 'תל אביב', streetText: null, neighborhoodText: 'נווה שאנן' },
    });
    expect(out.confidence.overall).toBe(0.9);
    expect(out.confidence.perField.direction).toBe(0.95);
  });

  it('drops unknown top-level keys and detail keys not allowed for the world', () => {
    const out = validateExtraction({ ...valid, junk: 1 }, lists);
    expect(out).not.toHaveProperty('junk');
    expect(out.details).toEqual({ condition: 'good' });
  });

  it('throws on a non-object or a missing is_post', () => {
    fails(null, 'invalid_shape');
    fails('x', 'invalid_shape');
    fails({ ...valid, is_post: undefined }, 'invalid_shape');
  });

  it('throws on an invalid enum value (so the caller retries once)', () => {
    fails({ ...valid, direction: 'sell' }, 'invalid_enum');
    fails({ ...valid, world_slug: 'moon' }, 'invalid_enum');
    fails({ ...valid, reject_reason: 'because' }, 'invalid_enum');
  });

  it('drops a sub-category that does not belong to the world instead of failing', () => {
    expect(validateExtraction({ ...valid, subcategory: 'cooked' }, lists).subcategory).toBeNull();
    expect(validateExtraction({ ...valid, world_slug: null }, lists).subcategory).toBeNull();
  });

  it('treats a missing direction as unknown', () => {
    expect(validateExtraction({ ...valid, direction: undefined }, lists).direction).toBe('unknown');
  });

  it('strips placeholders and control characters and caps lengths', () => {
    const out = validateExtraction(
      { ...valid, title: `ספה <PHONE>\u0007${'א'.repeat(200)}`, description: 'ב'.repeat(2000) },
      lists,
    );
    expect(out.title).not.toContain('<PHONE>');
    expect(out.title).not.toContain('\u0007');
    expect(out.title!.length).toBeLessThanOrEqual(80);
    expect(out.description!.length).toBe(1000);
  });

  it('turns an empty title into null', () => {
    expect(validateExtraction({ ...valid, title: '  <URL> ' }, lists).title).toBeNull();
  });

  it('returns a minimal rejected extraction when is_post is false', () => {
    const out = validateExtraction({ is_post: false, reject_reason: 'commercial', title: 'x' }, lists);
    expect(out).toMatchObject({ isPost: false, rejectReason: 'commercial', title: null, worldSlug: null });
    expect(validateExtraction({ is_post: false }, lists).rejectReason).toBe('not_a_post');
  });

  it('validates the time hint ranges and format', () => {
    const time = (t: object) => ({ ...valid, time: t });
    expect(validateExtraction(time({ kind: 'relative_day', day_offset: 1, time_hhmm: '08:00' }), lists).time)
      .toMatchObject({ kind: 'relative_day', dayOffset: 1, timeHhmm: '08:00' });
    fails(time({ kind: 'relative_day', day_offset: 99 }), 'invalid_time');
    fails(time({ kind: 'weekday', weekday: 7 }), 'invalid_time');
    fails(time({ kind: 'date', month: 13, day_of_month: 1 }), 'invalid_time');
    fails(time({ kind: 'relative_day', day_offset: 1, time_hhmm: '8am' }), 'invalid_time');
    fails(time({ kind: 'later' }), 'invalid_enum');
  });

  it('keeps ride fields only for the rides world and bounds seats and meeting points', () => {
    const ride = {
      origin_text: 'חיפה', destination_text: 'תל אביב', seats: 3,
      meeting_texts: ['a', 'b', 'c', 'd'],
    };
    const out = validateExtraction({ ...valid, world_slug: 'rides', subcategory: null, ride }, lists);
    expect(out.ride).toEqual({ originText: 'חיפה', destinationText: 'תל אביב', seats: 3, meetingTexts: ['a', 'b', 'c'] });
    expect(validateExtraction({ ...valid, ride }, lists).ride).toBeNull();
    const badSeats = validateExtraction({ ...valid, world_slug: 'rides', ride: { ...ride, seats: 20 } }, lists);
    expect(badSeats.ride?.seats).toBeNull();
  });

  it('clamps confidence to 0..1 and ignores an invalid language tag', () => {
    const out = validateExtraction(
      { ...valid, language: 'not a tag!', confidence: { overall: 1.7, per_field: { direction: -2 } } },
      lists,
    );
    expect(out.language).toBeNull();
    expect(out.confidence.overall).toBe(1);
    expect(out.confidence.perField.direction).toBe(0);
  });
});
