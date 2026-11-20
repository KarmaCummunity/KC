import { describe, expect, it } from 'vitest';
import { withoutKnowledgeSeriesKeys } from '@kc/domain';
import { fieldsForKind, firstMissingRequiredField, detailsForSubmit } from '../listingFieldSpecs';
import { lessonEditDetails, lessonEditFields } from '../lessonEditFields';
import { KINDS_BY_WORLD } from './listingKindFixtures';
const specs = fieldsForKind(KINDS_BY_WORLD.knowledge!.find((k) => k.slug === 'lesson_offer')!);
const slots = [{ starts_at: '2030-12-01T18:00:00Z', ends_at: '2030-12-01T19:00:00Z' }];
const base = { modality: 'video', capacity_per_slot: 1, topic: 'Maths' };

describe('stored lesson owner edit, without recreating its schedule', () => {
  for (const schedule of ['one_off', 'weekly']) {
    it(`allows unchanged ${schedule} create→store→edit without mode defaults`, () => {
      const form = { ...base, schedule, slots, series_weekdays: [2], series_time: '18:00', series_duration_minutes: 60 };
      const stored = withoutKnowledgeSeriesKeys(form);
      const edit = lessonEditFields(specs, stored);
      expect(edit.some((s) => s.key === 'schedule' || s.key.startsWith('series_'))).toBe(false);
      expect(firstMissingRequiredField(edit, stored)).toBeNull();
      expect(edit.some((s) => s.key === 'slots')).toBe(schedule === 'one_off');
      const sent = lessonEditDetails(detailsForSubmit(edit, stored));
      expect(sent).toEqual(stored);
      expect(sent).not.toHaveProperty('schedule');
      expect(sent).not.toHaveProperty('series_weekdays');
    });
  }
  it('retains one-off slot validation and edits, without hidden-mode loss', () => {
    const details = { ...base, slots };
    const edit = lessonEditFields(specs, details);
    expect(firstMissingRequiredField(edit, { ...details, slots: [] })?.key).toBe('slots');
    expect(detailsForSubmit(edit, details).slots).toEqual(slots);
  });
  it('keeps series-owned capacity in stored details without offering an unsupported editor', () => {
    const weekly = { ...base, capacity_per_slot: 3 };
    const edit = lessonEditFields(specs, weekly);
    expect(edit.some((s) => s.key === 'capacity_per_slot')).toBe(false);
    expect(lessonEditDetails(detailsForSubmit(edit, weekly))).toEqual(weekly);
    expect(lessonEditFields(specs, { ...weekly, slots }).some((s) => s.key === 'capacity_per_slot')).toBe(true);
  });
  it('strips stale create-only keys without deleting existing slots', () => {
    expect(lessonEditDetails({ ...base, schedule: 'weekly', series_weekdays: [2], slots })).toEqual({ ...base, slots });
  });
  it('does not change the create fields or mutate source details', () => {
    const details = { ...base };
    lessonEditFields(specs, details);
    expect(specs.find((s) => s.key === 'schedule')?.required).toBe(true);
    expect(specs.find((s) => s.key === 'slots')?.visibleWhen).toEqual({ key: 'schedule', equals: 'one_off' });
    expect(details).toEqual(base);
  });
});
