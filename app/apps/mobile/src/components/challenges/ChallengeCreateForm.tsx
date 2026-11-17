// Mapped to spec: docs/spec/10_challenges.md / FR-RESP-006 AC29 — the "open a challenge" form. A
// submit the domain rules refuse marks the field it is about and jumps there; nothing is sent.
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CHALLENGE_CADENCES,
  CHALLENGE_DIFFICULTIES,
  CHALLENGE_GOAL_DIRECTIONS,
  CHALLENGE_MEASUREMENTS,
  CHALLENGE_SCOPES,
  type ChallengeDraft,
} from '@kc/domain';
import { TextField } from '../ui/TextField';
import { PrimaryButton } from '../ui/Buttons';
import { OptionChips } from './OptionChips';
import {
  INITIAL_CHALLENGE_FORM,
  challengeDraftFromForm,
  type ChallengeFormState,
} from '../../lib/challenges/challengeDraftFromForm';
import { FormSection } from '../ui/FormSection';
import { useScrollToFirstInvalid } from '../ui/formScope';
import { challengeFormProblem, type ChallengeFormField } from '../../lib/challenges/challengeFormProblem';
import { challengeCodeMessage } from '../../lib/challenges/challengeErrorMessage';

interface ChallengeCreateFormProps {
  readonly busy: boolean;
  /** Localized message of the last failed submit, shown above the button. */
  readonly errorMessage: string | null;
  readonly onSubmit: (draft: ChallengeDraft) => void;
  /** The unified create header's publish button submits this form too. */
  readonly onPublishActionChange: (action: (() => void) | null, loading: boolean) => void;
}

/** The "open a challenge" form: collects raw input and hands a domain draft to `onSubmit`. */
export function ChallengeCreateForm({ busy, errorMessage, onSubmit, onPublishActionChange }: ChallengeCreateFormProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<ChallengeFormState>(INITIAL_CHALLENGE_FORM);
  const set = <K extends keyof ChallengeFormState>(key: K, value: ChallengeFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const isNumeric = form.measurement !== 'yes_no';
  const jumpToProblem = useScrollToFirstInvalid();
  // Nothing is marked before the first refused submit; from then on the mark follows the values.
  const [refusedSubmits, setRefusedSubmits] = useState(0);
  const problem = refusedSubmits > 0 ? challengeFormProblem(form) : null;
  /** The message under `field`, when the current problem is about it. */
  const errorOf = (field: ChallengeFormField) => (problem?.field === field ? challengeCodeMessage(t, problem.code) : undefined);
  // A refusal about no single field, or the server's own refusal, shows at the end of the form.
  const formError = problem && problem.field === null ? challengeCodeMessage(t, problem.code) : errorMessage;

  // Keep the header's publish action pointing at the latest form state without re-registering it.
  const submitRef = useRef<() => void>(() => undefined);
  submitRef.current = () => {
    if (challengeFormProblem(form)) {
      setRefusedSubmits((n) => n + 1);
      // Also when the same problem is still marked: the screen moves back to it every time.
      jumpToProblem();
      return;
    }
    onSubmit(challengeDraftFromForm(form));
  };
  useEffect(() => {
    onPublishActionChange(() => submitRef.current(), busy);
    return () => onPublishActionChange(null, false);
  }, [busy, onPublishActionChange]);

  return (
    <>
      <TextField
        label={t('challenges.form.title')}
        placeholder={t('challenges.form.titlePlaceholder')}
        value={form.title}
        onChangeText={(text) => set('title', text)}
        errorText={errorOf('title')}
        testID="challenge-form-title"
      />
      <TextField
        label={t('challenges.form.description')}
        value={form.description}
        onChangeText={(text) => set('description', text)}
        errorText={errorOf('description')}
        multiline
      />
      <OptionChips
        label={t('challenges.form.scope')}
        options={CHALLENGE_SCOPES.map((value) => ({ value, label: t(`challenges.scope.${value}`) }))}
        selected={form.scope}
        onSelect={(value) => set('scope', value)}
        hint={t(`challenges.scopeHint.${form.scope}`)}
      />
      <OptionChips
        label={t('challenges.form.measurement')}
        options={CHALLENGE_MEASUREMENTS.map((value) => ({ value, label: t(`challenges.measurement.${value}`) }))}
        selected={form.measurement}
        onSelect={(value) => set('measurement', value)}
        hint={t(`challenges.measurementHint.${form.measurement}`)}
      />
      <OptionChips
        label={t('challenges.form.cadence')}
        options={CHALLENGE_CADENCES.map((value) => ({ value, label: t(`challenges.cadence.${value}`) }))}
        selected={form.cadence}
        onSelect={(value) => set('cadence', value)}
        hint={t(`challenges.cadenceHint.${form.cadence}`)}
      />
      {isNumeric ? (
        <>
          <TextField
            label={t('challenges.form.goalValue')}
            value={form.goalValue}
            onChangeText={(text) => set('goalValue', text)}
            errorText={errorOf('goalValue')}
            inputKind="decimal"
          />
          <OptionChips
            label={t('challenges.form.goalDirection')}
            options={CHALLENGE_GOAL_DIRECTIONS.map((value) => ({ value, label: t(`challenges.direction.${value}`) }))}
            selected={form.goalDirection}
            onSelect={(value) => set('goalDirection', value)}
            error={errorOf('goalDirection')}
          />
        </>
      ) : null}
      <OptionChips
        label={t('challenges.form.difficulty')}
        options={CHALLENGE_DIFFICULTIES.map((value) => ({ value, label: t(`challenges.difficulty.${value}`) }))}
        selected={form.difficulty}
        onSelect={(value) => set('difficulty', form.difficulty === value ? null : value)}
      />
      <TextField
        label={t('challenges.form.topic')}
        placeholder={t('challenges.form.topicPlaceholder')}
        value={form.topicLabel}
        onChangeText={(text) => set('topicLabel', text)}
        errorText={errorOf('topicLabel')}
      />
      <TextField
        label={t('challenges.form.targetCycles')}
        helperText={t('challenges.form.targetCyclesHint')}
        value={form.targetCycles}
        onChangeText={(text) => set('targetCycles', text)}
        errorText={errorOf('targetCycles')}
        inputKind="integer"
      />
      {formError ? (
        <FormSection error={formError} outlined={false} testID="challenge-form-error">
          {null}
        </FormSection>
      ) : null}
      <PrimaryButton
        label={t('challenges.form.submit')}
        fullWidth
        disabled={busy}
        onPress={() => submitRef.current()}
        testID="challenge-form-submit"
      />
    </>
  );
}
