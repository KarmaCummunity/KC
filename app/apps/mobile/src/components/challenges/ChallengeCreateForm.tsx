import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  CHALLENGE_CADENCES,
  CHALLENGE_DIFFICULTIES,
  CHALLENGE_GOAL_DIRECTIONS,
  CHALLENGE_MEASUREMENTS,
  CHALLENGE_SCOPES,
  type ChallengeDraft,
} from '@kc/domain';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { formDecimalInputProps, formIntegerInputProps } from '../../lib/platform/formTextInputHints';
import { TextField } from '../ui/TextField';
import { PrimaryButton } from '../ui/Buttons';
import { OptionChips } from './OptionChips';
import {
  INITIAL_CHALLENGE_FORM,
  challengeDraftFromForm,
  type ChallengeFormState,
} from '../../lib/challenges/challengeDraftFromForm';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

interface ChallengeCreateFormProps {
  readonly busy: boolean;
  /** Localized message of the last failed submit, shown above the button. */
  readonly errorMessage: string | null;
  readonly onSubmit: (draft: ChallengeDraft) => void;
  /** The unified create header's publish button submits this form too. */
  readonly onPublishActionChange: (action: (() => void) | null, loading: boolean) => void;
}

const useStyles = makeUseStyles(({ colors }) => ({
  form: { gap: spacing.md },
  error: { ...typography.bodySmall, color: colors.error, textAlign: rtlTextAlignStart },
}));

/** The "open a challenge" form: collects raw input and hands a domain draft to `onSubmit`. */
export function ChallengeCreateForm({ busy, errorMessage, onSubmit, onPublishActionChange }: ChallengeCreateFormProps) {
  const { t } = useTranslation();
  const styles = useStyles();
  const [form, setForm] = useState<ChallengeFormState>(INITIAL_CHALLENGE_FORM);
  const set = <K extends keyof ChallengeFormState>(key: K, value: ChallengeFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const isNumeric = form.measurement !== 'yes_no';

  // Keep the header's publish action pointing at the latest form state without re-registering it.
  const submitRef = useRef<() => void>(() => undefined);
  submitRef.current = () => onSubmit(challengeDraftFromForm(form));
  useEffect(() => {
    onPublishActionChange(() => submitRef.current(), busy);
    return () => onPublishActionChange(null, false);
  }, [busy, onPublishActionChange]);

  return (
    <View style={styles.form}>
      <TextField
        label={t('challenges.form.title')}
        placeholder={t('challenges.form.titlePlaceholder')}
        value={form.title}
        onChangeText={(text) => set('title', text)}
        testID="challenge-form-title"
      />
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      <TextField
        label={t('challenges.form.description')}
        value={form.description}
        onChangeText={(text) => set('description', text)}
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
            {...formDecimalInputProps}
          />
          <OptionChips
            label={t('challenges.form.goalDirection')}
            options={CHALLENGE_GOAL_DIRECTIONS.map((value) => ({ value, label: t(`challenges.direction.${value}`) }))}
            selected={form.goalDirection}
            onSelect={(value) => set('goalDirection', value)}
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
      />
      <TextField
        label={t('challenges.form.targetCycles')}
        helperText={t('challenges.form.targetCyclesHint')}
        value={form.targetCycles}
        onChangeText={(text) => set('targetCycles', text)}
        {...formIntegerInputProps}
      />
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      <PrimaryButton
        label={t('challenges.form.submit')}
        fullWidth
        disabled={busy}
        onPress={() => submitRef.current()}
        testID="challenge-form-submit"
      />
    </View>
  );
}
