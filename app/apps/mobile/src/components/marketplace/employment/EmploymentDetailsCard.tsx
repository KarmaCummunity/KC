// Mapped to spec: docs/spec/05_giving_worlds.md §5.11 · #2537 —
// job requirements and estimated salary on a job-offer detail screen.
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text, typography } from '@kc/ui';
import { parseEmploymentJobOfferDetails } from '@kc/domain';
import { employmentSalaryLabelFromParsed } from '../../../lib/employment/employmentSalaryLabel';
import { useEventSectionStyles } from '../events/eventSectionStyles';

interface Props {
  /** The listing's `posts.details` document. */
  readonly details: Readonly<Record<string, unknown>>;
}

export function EmploymentDetailsCard({ details }: Props) {
  const { t } = useTranslation();
  const styles = useEventSectionStyles();
  const parsed = parseEmploymentJobOfferDetails(details);
  const salary = employmentSalaryLabelFromParsed(parsed, t);
  if (!parsed.requirements && !salary) return null;

  return (
    <View style={styles.box} testID="employment-section">
      <Text style={typography.h3}>{t('jobOffer.detail.title')}</Text>
      {salary ? (
        <Text style={styles.line} testID="employment-salary">
          {t('jobOffer.detail.salary')}: {salary}
        </Text>
      ) : null}
      {parsed.requirements ? (
        <Text style={styles.line} testID="employment-requirements">
          {t('jobOffer.detail.requirements')}: {parsed.requirements}
        </Text>
      ) : null}
    </View>
  );
}
