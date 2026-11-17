// Mapped to spec: docs/spec/05_giving_worlds.md §5.11 (#1476) — a job offer names the
// organization offering the job. A member with no organization allowed to post jobs is told
// why, and that looking for work is open to everyone.
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@kc/ui';
import type { JobOfferOrgChoice } from '../../hooks/useJobOfferOrgChoice';
import { useCreatePostStyles } from '../../screens/tabs/create.styles';
import { ListingFieldFrame } from './ListingFieldFrame';
import { OrganizationPicker } from './OrganizationPicker';

interface Props {
  readonly choice: JobOfferOrgChoice;
  readonly disabled?: boolean;
}

export function JobOfferOrgSection({ choice, disabled = false }: Props) {
  const { t } = useTranslation();
  const styles = useCreatePostStyles();
  if (!choice.required) return null;
  if (choice.loaded && choice.organizations.length === 0) {
    return (
      <View style={styles.section} testID="job-offer-no-org">
        <Text style={styles.sectionLabel}>{t('jobOffer.create.noEligibleOrg')}</Text>
      </View>
    );
  }
  return (
    <ListingFieldFrame field="org">
      <OrganizationPicker
        organizations={choice.organizations}
        value={choice.orgId}
        onChange={choice.setOrgId}
        disabled={disabled}
      />
    </ListingFieldFrame>
  );
}
