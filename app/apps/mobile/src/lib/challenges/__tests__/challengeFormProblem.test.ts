// docs/spec/10_challenges.md / FR-RESP-006 AC29 — a refused challenge draft names the field it is about.
import { describe, expect, it } from 'vitest';
import { INITIAL_CHALLENGE_FORM, type ChallengeFormState } from '../challengeDraftFromForm';
import { challengeFormProblem } from '../challengeFormProblem';

const form = (patch: Partial<ChallengeFormState>): ChallengeFormState => ({ ...INITIAL_CHALLENGE_FORM, title: 'Walk every day', ...patch });

describe('challengeFormProblem', () => {
  it('finds nothing wrong with a valid draft', () => {
    expect(challengeFormProblem(form({}))).toBeNull();
  });

  it('points a short title at the title field', () => {
    expect(challengeFormProblem(form({ title: 'a' }))).toEqual({ code: 'title_too_short', field: 'title' });
  });

  it('points a goal that is not a number at the goal field', () => {
    expect(challengeFormProblem(form({ measurement: 'count', goalValue: 'abc' }))).toEqual({
      code: 'goal_value_invalid',
      field: 'goalValue',
    });
  });

  it('points an impossible number of rounds at the rounds field', () => {
    expect(challengeFormProblem(form({ targetCycles: '0' }))).toEqual({ code: 'target_cycles_invalid', field: 'targetCycles' });
  });
});
