// FR-KNOW-003 AC2 (#2034) — the knowledge create form: six exchange kinds, curated fields that
// cover every key the binding schema of migration 0703 requires, and the slot list of a lesson.
// Split from listingFieldSpecs.test.ts (300-line cap).
import { describe, expect, it } from 'vitest';
import { detailsForSubmit, fieldsForKind, firstMissingRequiredField, kindChoices, kindForDirection } from '../listingFieldSpecs';
import { KINDS_BY_WORLD } from './listingKindFixtures';

describe('listing field specs — knowledge (#1630, #2034)', () => {
  const kinds = KINDS_BY_WORLD.knowledge!;
  it('covers every key the server schema requires: asked for, or filled by a default', () => {
    for (const k of kinds) {
      const schema = k.detailSchema as { required: string[] };
      const specs = fieldsForKind(k);
      for (const key of schema.required) {
        const spec = specs.find((s) => s.key === key)!;
        expect(spec.required === true || ('defaultValue' in spec && spec.defaultValue !== undefined)).toBe(true);
      }
    }
  });

  it('opens on a lesson to give and a learning request to ask for (#2034)', () => {
    expect(kindForDirection(kinds, 'give')?.slug).toBe('lesson_offer');
    expect(kindForDirection(kinds, 'request')?.slug).toBe('learning_request');
  });

  it('asks for the lesson times as a required slot list, one place each by default', () => {
    const specs = fieldsForKind(kinds[0]!);
    expect(specs.find((s) => s.key === 'slots')).toMatchObject({ type: 'slotList', required: true, maxSlots: 20 });
    expect(specs.find((s) => s.key === 'capacity_per_slot')).toMatchObject({ type: 'count', min: 1, defaultValue: 1 });
  });

  it('lets a lesson run one-off times or every week, asking only for what the choice needs (#2479)', () => {
    const specs = fieldsForKind(kinds[0]!);
    const filled = { modality: 'video', capacity_per_slot: 1 };
    expect(specs.find((s) => s.key === 'schedule')).toMatchObject({ type: 'choice', options: ['one_off', 'weekly'], defaultValue: 'one_off' });
    expect(firstMissingRequiredField(specs, { ...filled, schedule: 'one_off' })?.key).toBe('slots');
    expect(firstMissingRequiredField(specs, { ...filled, schedule: 'weekly' })?.key).toBe('series_weekdays');
    expect(firstMissingRequiredField(specs, { ...filled, schedule: 'weekly', series_weekdays: [0], series_time: '18:00' })).toBeNull();
    const weekly = { ...filled, schedule: 'weekly', slots: [{ starts_at: 'x', ends_at: 'y' }], series_weekdays: [0], series_time: '18:00' };
    expect(detailsForSubmit(specs, weekly)).not.toHaveProperty('slots');
    expect(detailsForSubmit(specs, { ...weekly, schedule: 'one_off' })).not.toHaveProperty('series_weekdays');
  });

  it('treats the consulting disclaimer as unanswered until it is switched on', () => {
    const specs = fieldsForKind(kinds.find((k) => k.slug === 'consulting_hour')!);
    const filled = { profession: 'lawyer', modality: 'video', capacity_per_slot: 1, slots: [{ starts_at: 'x', ends_at: 'y' }] };
    expect(firstMissingRequiredField(specs, { ...filled, disclaimer_accepted: false })?.key).toBe('disclaimer_accepted');
    expect(firstMissingRequiredField(specs, { ...filled, disclaimer_accepted: true })).toBeNull();
  });

  it('offers the three knowledge offers and the three knowledge requests (#2034)', () => {
    expect(kindChoices(kinds, 'give').map((k) => k.slug)).toEqual([
      'lesson_offer', 'mentoring_offer', 'consulting_hour',
    ]);
    expect(kindChoices(kinds, 'request').map((k) => k.slug)).toEqual([
      'learning_request', 'mentoring_request', 'question',
    ]);
  });
});
