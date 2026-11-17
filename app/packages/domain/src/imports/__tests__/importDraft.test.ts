import { describe, expect, it } from 'vitest';
import { manualImportDraft, parseImportDraft } from '../importDraft';

const wireExtraction = {
  isPost: true, rejectReason: null, direction: 'offer', worldSlug: 'items', subcategory: 'furniture', title: 'Sofa', description: 'Good shape',
  place: { cityText: 'Tel Aviv', streetText: null, neighborhoodText: null },
  time: { kind: 'relative_day', dayOffset: 1, weekday: null, month: null, dayOfMonth: null, timeHhmm: '08:00', timePeriod: null, recurringWeekdays: [] },
  ride: null, details: { condition: 'good', junk: { a: 1 } }, language: 'he', confidence: { overall: 0.9, perField: { direction: 0.95 } },
};
const candidate = { level: 'city', placeId: '5000', nameHe: 'x', cityId: '5000', score: 0.9, margin: 0.5 };
const wire = {
  importId: 'imp-1', routing: 'confirm', reason: 'ok', confidence: 0.82, extraction: wireExtraction,
  city: { status: 'picked', picked: candidate, suggestions: [] }, street: null, ride: null,
  time: { at: '2026-11-05T06:00:00.000Z', dateIso: '2026-11-05', recurringWeekdays: [], ambiguousHour: true, dropped: null },
  confirmFields: ['city', 'time'], removed: { phone: 1, email: 0, id: 0, url: 0 }, truncated: false,
};

describe('parseImportDraft', () => {
  it('reads a full answer of the function', () => {
    const d = parseImportDraft(wire);
    expect(d.importId).toBe('imp-1');
    expect(d.routing).toBe('confirm');
    expect(d.extraction?.worldSlug).toBe('items');
    expect(d.extraction?.time).toMatchObject({ kind: 'relative_day', dayOffset: 1, timeHhmm: '08:00' });
    expect(d.city?.picked?.placeId).toBe('5000');
    expect(d.time?.at?.toISOString()).toBe('2026-11-05T06:00:00.000Z');
    expect(d.time?.ambiguousHour).toBe(true);
    expect(d.confirmFields).toEqual(['city', 'time']);
    expect(d.removed?.phone).toBe(1);
  });

  it('keeps only primitive detail values', () => {
    expect(parseImportDraft(wire).extraction?.details).toEqual({ condition: 'good' });
  });

  it.each([null, undefined, 'x', 5, [], {}, { routing: 'maybe' }])('turns %j into the manual route', (raw) => {
    const d = parseImportDraft(raw);
    expect(d.routing).toBe('manual');
    expect(d.reason).toBe('invalid_response');
    expect(d.extraction).toBeNull();
  });

  it('a refusal of the function (switched off, a limit) is the manual route with its reason', () => {
    const d = parseImportDraft({ importId: null, routing: 'manual', reason: 'rate_limited', confidence: 0, extraction: null, confirmFields: [] });
    expect(d).toMatchObject({ routing: 'manual', reason: 'rate_limited', importId: null, extraction: null });
  });

  it('a ready answer without a usable extraction cannot be ready', () => {
    expect(parseImportDraft({ ...wire, routing: 'ready', extraction: null }).routing).toBe('manual');
    expect(parseImportDraft({ ...wire, extraction: { ...wireExtraction, isPost: false } })).toMatchObject({ routing: 'manual', extraction: null });
  });

  it('drops unreadable parts instead of failing the whole draft', () => {
    const d = parseImportDraft({ ...wire, city: { status: 'bogus' }, time: 'later', ride: { origin: 1 }, removed: 'x', confirmFields: 'city' });
    expect(d.city).toBeNull();
    expect(d.time).toBeNull();
    expect(d.ride).toBeNull();
    expect(d.removed).toBeNull();
    expect(d.confirmFields).toEqual([]);
    expect(d.routing).toBe('confirm');
  });

  it('a picked place with no readable candidate is no pick', () => {
    expect(parseImportDraft({ ...wire, city: { status: 'picked', picked: { level: 'city' }, suggestions: [candidate] } }).city)
      .toMatchObject({ status: 'none', picked: null });
  });

  it('reads a ride route and bad numbers fall back to zero', () => {
    const place = { status: 'picked', picked: candidate, suggestions: [] };
    const d = parseImportDraft({ ...wire, ride: { origin: place, destination: place, meetings: [place, 'x'] }, confidence: 'high' });
    expect(d.ride?.meetings).toHaveLength(1);
    expect(d.confidence).toBe(0);
  });

  it('an unknown enum value becomes its safe default', () => {
    const d = parseImportDraft({ ...wire, extraction: { ...wireExtraction, direction: 'sell', time: { kind: 'later' } } });
    expect(d.extraction?.direction).toBe('unknown');
    expect(d.extraction?.time.kind).toBe('none');
  });
});

describe('manualImportDraft', () => {
  it('has nothing to prefill', () => {
    expect(manualImportDraft('empty_text')).toMatchObject({ routing: 'manual', reason: 'empty_text', extraction: null, importId: null, confirmFields: [] });
  });
});
