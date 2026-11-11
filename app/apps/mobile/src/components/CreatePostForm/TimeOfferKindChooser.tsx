// Mapped to spec: docs/spec/08_organizations.md Events (G1 step 5, D31) — a member of an
// organization chooses what a time offer is: a volunteer shift (the default) or the
// organization's event, which then needs the organization it is published for.
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@kc/ui';
import type { OrgEventChoice } from '../../hooks/useOrgEventChoice';
import { useCreatePostStyles } from '../../screens/tabs/create.styles';
import { Chip } from '../ui/Chip';
import { ChipSelectRow } from '../filterKit/ChipSelectRow';
import { ListingFieldFrame } from './ListingFieldFrame';
import { OrganizationPicker } from './OrganizationPicker';

interface Props {
  readonly choice: OrgEventChoice;
  readonly disabled?: boolean;
}

export function TimeOfferKindChooser({ choice, disabled = false }: Props) {
  const { t } = useTranslation();
  const styles = useCreatePostStyles();
  return (
    <>
      <View style={styles.section} testID="time-offer-kind">
        <Text style={styles.sectionLabel}>{t('eventPost.create.kindLabel')}</Text>
        <ChipSelectRow testID="time-offer-kind-chips" expandable={false}>
          <Chip
            testID="time-offer-kind-shift"
            label={t('eventPost.create.kindShift')}
            selected={!choice.isOrgEvent}
            onPress={() => choice.setWantsOrgEvent(false)}
            disabled={disabled}
          />
          <Chip
            testID="time-offer-kind-event"
            label={t('eventPost.create.kindEvent')}
            selected={choice.isOrgEvent}
            onPress={() => choice.setWantsOrgEvent(true)}
            disabled={disabled}
          />
        </ChipSelectRow>
      </View>
      {choice.isOrgEvent ? (
        <ListingFieldFrame field="org">
          <OrganizationPicker
            organizations={choice.organizations}
            value={choice.orgId}
            onChange={choice.setOrgId}
            disabled={disabled}
          />
        </ListingFieldFrame>
      ) : null}
    </>
  );
}
