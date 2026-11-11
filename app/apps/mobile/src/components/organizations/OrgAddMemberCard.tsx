// FR-ORG (G18) — add a member by share handle, with a role. The roles offered are the ones the
// viewer may give (canAssignOrgRole): an admin gives any role, a manager employee and volunteer.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { canAssignOrgRole, ORG_MEMBER_ROLES, type OrgMemberRole } from '@kc/domain';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { PrimaryButton } from '../ui/Buttons';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { TextField } from '../ui/TextField';
import { orgErrorKey } from '../../lib/organizations/orgErrorMessage';
import { webTextRtl } from '../../lib/webRtlStyle';

export interface OrgAddMemberCardProps {
  readonly myRole: OrgMemberRole;
  readonly busy: boolean;
  readonly onAdd: (shareHandle: string, role: OrgMemberRole) => Promise<void>;
}

export function OrgAddMemberCard({ myRole, busy, onAdd }: OrgAddMemberCardProps) {
  const { t } = useTranslation();
  const styles = useStyles();
  const roles = ORG_MEMBER_ROLES.filter((role) => canAssignOrgRole(myRole, role));
  const [handle, setHandle] = useState('');
  const [role, setRole] = useState<OrgMemberRole>('org_volunteer');
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const add = async () => {
    setErrorKey(null);
    try {
      await onAdd(handle, role);
      setHandle('');
    } catch (err) {
      setErrorKey(orgErrorKey(err));
    }
  };

  return (
    <Card padding="base" style={styles.card} testID="org-add-member">
      <Text style={[styles.title, webTextRtl]}>{t('organizations.members.addTitle')}</Text>
      <TextField
        testID="org-add-member-handle"
        label={t('organizations.members.handleLabel')}
        placeholder={t('organizations.members.handlePlaceholder')}
        value={handle}
        onChangeText={setHandle}
        autoCapitalize="none"
        autoCorrect={false}
        errorText={errorKey ? t(errorKey) : undefined}
      />
      <Text style={[styles.label, webTextRtl]}>{t('organizations.members.roleLabel')}</Text>
      <View style={styles.roles}>
        {roles.map((option) => (
          <Chip
            key={option}
            testID={`org-add-member-role-${option}`}
            size="md"
            selected={role === option}
            onPress={() => setRole(option)}
            label={t(`organizations.roles.${option}`)}
          />
        ))}
      </View>
      <PrimaryButton
        testID="org-add-member-submit"
        label={t('organizations.members.add')}
        icon="person-add-outline"
        loading={busy}
        disabled={handle.trim() === ''}
        onPress={() => void add()}
      />
    </Card>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  card: { gap: spacing.sm },
  title: { ...typography.bodyLarge, ...typography.semiBold, color: colors.textPrimary },
  label: { ...typography.caption, color: colors.textSecondary },
  roles: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.xs },
}));
