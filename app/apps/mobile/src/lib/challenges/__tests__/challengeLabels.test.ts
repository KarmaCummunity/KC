import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { challengeGoalLabel } from '../challengeLabels';

// A minimal stand-in for i18next that interpolates {{var}} into the key's template.
const templates: Record<string, string> = {
  'challenges.unit.count': '{{value}}',
  'challenges.unit.duration_minutes': '{{value}} min',
  'challenges.goal.at_least': 'at least {{value}}',
  'challenges.goal.at_most': 'at most {{value}}',
};
const t = ((key: string, vars?: Record<string, unknown>) =>
  (templates[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars?.[name]))) as unknown as TFunction;

describe('challengeGoalLabel', () => {
  it('describes a numeric goal with its unit and direction', () => {
    expect(challengeGoalLabel(t, { measurement: 'count', goalValue: 10, goalDirection: 'at_least' })).toBe('at least 10');
    expect(challengeGoalLabel(t, { measurement: 'duration_minutes', goalValue: 30, goalDirection: 'at_most' })).toBe(
      'at most 30 min',
    );
  });

  it('has no label for a yes/no or goal-less challenge', () => {
    expect(challengeGoalLabel(t, { measurement: 'yes_no', goalValue: null, goalDirection: null })).toBeNull();
    expect(challengeGoalLabel(t, { measurement: 'count', goalValue: null, goalDirection: null })).toBeNull();
  });
});
