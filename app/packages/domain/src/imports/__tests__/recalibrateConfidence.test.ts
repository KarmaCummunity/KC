import { describe, expect, it } from 'vitest';
import { recalibrateConfidence, DEFAULT_IMPORT_THRESHOLDS, type ConfidenceSignals } from '../recalibrateConfidence';
import type { ExtractedPost } from '../importTypes';

const base: ExtractedPost = {
  isPost: true, rejectReason: null, direction: 'offer', worldSlug: 'items', subcategory: 'furniture',
  title: 'ספה תלת מושבית', description: 'ספה במצב טוב, לאסוף השבוע',
  place: { cityText: 'תל אביב', streetText: null, neighborhoodText: null },
  time: { kind: 'none', dayOffset: null, weekday: null, month: null, dayOfMonth: null, timeHhmm: null, timePeriod: null, recurringWeekdays: [] },
  ride: null, details: {}, language: 'he',
  confidence: { overall: 0.95, perField: { direction: 0.95, world: 0.95, title: 0.95, city: 0.95 } },
};
const signals: ConfidenceSignals = {
  required: ['direction', 'world', 'title', 'city'],
  directionCue: true, conflictingCues: false, textLength: 120,
  place: { city: { score: 0.97, margin: 0.4 } }, autoPickedFields: [],
};
const run = (e: Partial<ExtractedPost> = {}, s: Partial<ConfidenceSignals> = {}) =>
  recalibrateConfidence({ ...base, ...e }, { ...signals, ...s });

describe('recalibrateConfidence', () => {
  it('routes a clean, fully resolved extraction to ready', () => {
    const r = run();
    expect(r.routing).toBe('ready');
    expect(r.overall).toBeGreaterThanOrEqual(DEFAULT_IMPORT_THRESHOLDS.ready);
    expect(r.confirmFields).toEqual([]);
  });

  it('never trusts the model alone: no direction cue lowers direction', () => {
    const r = run({}, { directionCue: false });
    expect(r.perField.direction).toBeLessThan(0.95);
  });

  it('conflicting offer/request cues cap direction and force confirm or manual', () => {
    const r = run({}, { conflictingCues: true });
    expect(r.perField.direction).toBeLessThanOrEqual(0.4);
    expect(r.routing).not.toBe('ready');
  });

  it('unknown direction scores zero and cannot be ready', () => {
    const r = run({ direction: 'unknown' });
    expect(r.perField.direction).toBe(0);
    expect(r.routing).not.toBe('ready');
  });

  it('a city match with a thin margin is capped and needs confirmation', () => {
    const r = run({}, { place: { city: { score: 0.9, margin: 0.05 } } });
    expect(r.perField.city).toBeLessThanOrEqual(0.6);
    expect(r.routing).toBe('confirm');
  });

  it('a missing required city scores zero', () => {
    const r = run({}, { place: {} });
    expect(r.perField.city).toBe(0);
    expect(r.overall).toBe(0);
    expect(r.routing).toBe('manual');
  });

  it('auto-picked fields are listed for highlighting and stop a ready route', () => {
    const r = run({}, { autoPickedFields: ['city'] });
    expect(r.confirmFields).toEqual(['city']);
    expect(r.routing).toBe('confirm');
  });

  it('overall is the minimum of the required fields', () => {
    const r = run({ confidence: { overall: 0.99, perField: { direction: 0.95, world: 0.6, title: 0.95, city: 0.95 } } });
    expect(r.overall).toBeCloseTo(0.6, 5);
  });

  it('very short text lowers confidence', () => {
    expect(run({}, { textLength: 8 }).overall).toBeLessThan(run().overall);
  });

  it('routes non-posts, rejected posts and missing required fields to manual', () => {
    expect(run({ isPost: false }).routing).toBe('manual');
    expect(run({ rejectReason: 'commercial' }).routing).toBe('manual');
    expect(run({ title: null }).routing).toBe('manual');
    expect(run({ worldSlug: null }).routing).toBe('manual');
  });

  it('honours custom thresholds (config, not hard-coded) at the boundary', () => {
    const edge = { confidence: { overall: 0.8, perField: { direction: 0.8, world: 0.8, title: 0.8, city: 0.8 } } };
    expect(run(edge).routing).toBe('confirm');
    const r = recalibrateConfidence({ ...base, ...edge }, signals, { ready: 0.8, confirm: 0.5 });
    expect(r.routing).toBe('ready');
  });
});
