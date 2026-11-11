// FR-MOD-002 AC1 (#2096): the report-a-problem form body — intro, optional category, description.
//
// Presentational: the screen owns the values and the submit. Layout follows the design
// tokens only (spacing, typography, radius); no hard-coded sizes.
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SUPPORT_ISSUE_DESCRIPTION_MAX, SUPPORT_ISSUE_DESCRIPTION_MIN } from '@kc/application';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { Chip } from '../ui/Chip';
import { TextField } from '../ui/TextField';
import { Card } from '../ui/Card';
import type { FormFieldFocusBindings } from '../../hooks/useFormFieldFocus';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../../lib/webRtlStyle';

/** The optional categories, in display order; the server stores the key verbatim. */
export const REPORT_ISSUE_CATEGORIES = ['Bug', 'Account', 'Suggestion', 'Other'] as const;

export interface ReportIssueFormProps {
  readonly category: string | null;
  /** Called with the tapped category, or `null` when the selected one is tapped again. */
  readonly onCategoryChange: (category: string | null) => void;
  readonly description: string;
  readonly onDescriptionChange: (text: string) => void;
  /** Keyboard-toolbar wiring for the description field (useFormFieldFocus). */
  readonly descriptionField?: FormFieldFocusBindings;
}

export function ReportIssueForm({
  category,
  onCategoryChange,
  description,
  onDescriptionChange,
  descriptionField,
}: ReportIssueFormProps) {
  const { t } = useTranslation();
  const styles = useReportIssueFormStyles();
  const trimmedLength = description.trim().length;
  const tooShort = trimmedLength > 0 && trimmedLength < SUPPORT_ISSUE_DESCRIPTION_MIN;
  const { ref: descriptionRef, ...descriptionFocusProps } = descriptionField ?? {};

  return (
    <>
      <Text style={styles.intro}>{t('settings.reportIssueScreen.copy')}</Text>

      <Card padding="base" style={styles.card}>
        <Text style={styles.sectionLabel}>{t('settings.reportIssueScreen.categoryLabel')}</Text>
        {/* Two equal chips per row, so no category is left alone on a line. */}
        <View style={styles.chipGrid}>
          {REPORT_ISSUE_CATEGORIES.map((cat) => {
            const selected = category === cat;
            return (
              <Chip
                key={cat}
                testID={`report-issue-category-${cat}`}
                size="md"
                style={styles.chipCell}
                selected={selected}
                onPress={() => onCategoryChange(selected ? null : cat)}
                label={t(`settings.reportIssueScreen.categories.${cat}`)}
              />
            );
          })}
        </View>

        {/* No `textAlign` here: TextField aligns the placeholder to the reading-start edge and
            lets typed text follow its own language (FR-RESP-006 AC21). A physical `left` would
            pin both to the left on native, where inputs do not mirror under forced RTL. */}
        <TextField
          ref={descriptionRef}
          {...descriptionFocusProps}
          testID="report-issue-description"
          label={t('settings.reportIssueScreen.descriptionLabel')}
          style={styles.input}
          multiline
          numberOfLines={6}
          placeholder={t('settings.reportIssueScreen.descriptionPlaceholder')}
          value={description}
          onChangeText={onDescriptionChange}
          maxLength={SUPPORT_ISSUE_DESCRIPTION_MAX}
        />
        <View style={styles.inputFooter}>
          <Text style={styles.minLength}>{tooShort ? t('settings.reportIssueScreen.descriptionMinLength') : ''}</Text>
          <Text style={styles.counter}>{`${description.length}/${SUPPORT_ISSUE_DESCRIPTION_MAX}`}</Text>
        </View>
      </Card>
    </>
  );
}

const useReportIssueFormStyles = makeUseStyles(({ colors }) => ({
  intro: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  card: { gap: spacing.md, ...webViewRtl },
  sectionLabel: {
    ...typography.label,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, ...webViewRtl },
  // Just under half the row, growing to fill it: two chips per row whatever the label length.
  chipCell: { flexBasis: '40%', flexGrow: 1, justifyContent: 'center' },
  // About five lines of text before the field scrolls.
  input: { minHeight: spacing['4xl'] * 2 },
  inputFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    ...webViewRtl,
  },
  minLength: {
    ...typography.caption,
    flex: 1,
    color: colors.error,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  counter: { ...typography.caption, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
}));
