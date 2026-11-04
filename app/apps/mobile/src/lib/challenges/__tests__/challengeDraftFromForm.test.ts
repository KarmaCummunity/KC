import { describe, expect, it } from 'vitest';
import { validateChallengeDraft } from '@kc/domain';
import {
  INITIAL_CHALLENGE_FORM,
  challengeDraftFromForm,
  parseOptionalNumber,
} from '../challengeDraftFromForm';

describe('parseOptionalNumber', () => {
  it('treats blank as unset and accepts a decimal comma', () => {
    expect(parseOptionalNumber('   ')).toBeNull();
    expect(parseOptionalNumber('12')).toBe(12);
    expect(parseOptionalNumber('2,5')).toBe(2.5);
  });

  it('keeps garbage as NaN so validation can reject it', () => {
    expect(parseOptionalNumber('abc')).toBeNaN();
  });
});

describe('challengeDraftFromForm', () => {
  it('builds a valid yes/no draft from the initial form with a title', () => {
    const draft = challengeDraftFromForm({ ...INITIAL_CHALLENGE_FORM, title: 'Morning walk' });
    expect(draft).toMatchObject({ goalValue: null, goalDirection: null, description: null, endsAt: null });
    expect(() => validateChallengeDraft(draft)).not.toThrow();
  });

  it('drops a goal typed before switching back to yes/no', () => {
    const draft = challengeDraftFromForm({
      ...INITIAL_CHALLENGE_FORM,
      title: 'Walk',
      measurement: 'yes_no',
      goalValue: '5',
    });
    expect(draft.goalValue).toBeNull();
    expect(draft.goalDirection).toBeNull();
  });

  it('pairs a numeric goal with its direction and trims optional text', () => {
    const draft = challengeDraftFromForm({
      ...INITIAL_CHALLENGE_FORM,
      title: 'Steps',
      measurement: 'count',
      goalValue: '10000',
      goalDirection: 'at_least',
      topicLabel: '  health ',
      targetCycles: '30',
    });
    expect(draft).toMatchObject({ goalValue: 10000, goalDirection: 'at_least', topicLabel: 'health', targetCycles: 30 });
    expect(() => validateChallengeDraft(draft)).not.toThrow();
  });
});
