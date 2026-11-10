// Mapped to spec: docs/spec/08_organizations.md Events (G1 step 5, D31) — the organization an
// event is published for. Lists only the organizations the member belongs to (any role); the
// server re-checks membership on publish (`event_org_required`).
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@kc/ui';
import type { OrganizationMembershipOption } from '@kc/domain';
import { useCreatePostStyles } from '../../screens/tabs/create.styles';
import { Chip } from '../ui/Chip';
import { ChipSelectRow } from '../filterKit/ChipSelectRow';

interface Props {
  readonly organizations: readonly OrganizationMembershipOption[];
  readonly value: string | null;
  readonly onChange: (orgId: string) => void;
  readonly disabled?: boolean;
}

export function OrganizationPicker({ organizations, value, onChange, disabled = false }: Props) {
  const { t } = useTranslation();
  const styles = useCreatePostStyles();
  return (
    <View style={styles.section} testID="org-picker">
      <Text style={styles.sectionLabel}>
        {t('eventPost.create.orgLabel')}
        <Text style={styles.required}> *</Text>
      </Text>
      <ChipSelectRow testID="org-picker-chips">
        {organizations.map((org) => (
          <Chip
            key={org.orgId}
            testID={`org-picker-${org.orgId}`}
            label={org.name}
            selected={value === org.orgId}
            onPress={() => onChange(org.orgId)}
            disabled={disabled}
          />
        ))}
      </ChipSelectRow>
    </View>
  );
}
