// FR-ORG (G18) — one organization's members: name and role of each, add by share handle (admins
// and managers), remove a member or leave. The server keeps the last admin (`org_last_admin`).
import React, { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { canManageOrgMembers, canRemoveOrgMember, type OrgMember, type OrgMemberRole } from '@kc/domain';
import { makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { GhostButton, Screen } from '../../../src/components/ui';
import { AvatarInitials } from '../../../src/components/AvatarInitials';
import { OrgAddMemberCard } from '../../../src/components/organizations/OrgAddMemberCard';
import { ConfirmActionModal } from '../../../src/components/post/ConfirmActionModal';
import { useOrgMembers } from '../../../src/hooks/useOrgMembers';
import { orgErrorKey } from '../../../src/lib/organizations/orgErrorMessage';
import { useShellStackScreenOptions } from '../../../src/navigation/shellStackScreenOptions';
import { webTextRtl, webViewRtl } from '../../../src/lib/webRtlStyle';
export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

export default function OrganizationMembersScreen() {
  const shellStackScreenOptions = useShellStackScreenOptions();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useStyles();
  const state = useOrgMembers(String(orgId));
  const [pending, setPending] = useState<OrgMember | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const myRole: OrgMemberRole | null = state.organization?.role ?? null;
  const orgName = state.organization?.name ?? '';
  const leaving = pending !== null && pending.userId === state.myUserId;

  const confirmRemove = async () => {
    if (!pending) return;
    try {
      await state.remove(pending.userId);
      setPending(null);
      // Leaving ends this screen: the viewer no longer reads the member list.
      if (leaving) router.back();
    } catch (err) {
      setErrorKey(orgErrorKey(err));
    }
  };

  return (
    <>
      <Stack.Screen options={{ ...shellStackScreenOptions, headerTitle: orgName || t('organizations.members.title') }} />
      <Screen scroll>
        <View style={[styles.body, webViewRtl]} testID="org-members-screen">
          {state.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
          {myRole && canManageOrgMembers(myRole) ? (
            <OrgAddMemberCard myRole={myRole} busy={state.busy} onAdd={state.add} />
          ) : null}
          <Text style={[styles.sectionTitle, webTextRtl]}>{t('organizations.members.title')}</Text>
          {state.members.map((member) => (
            <MemberRow
              key={member.userId}
              member={member}
              isSelf={member.userId === state.myUserId}
              canRemove={canRemoveOrgMember(myRole, member.role, member.userId === state.myUserId)}
              onRemove={() => { setErrorKey(null); setPending(member); }}
            />
          ))}
        </View>
      </Screen>
      <ConfirmActionModal
        visible={pending !== null}
        title={leaving ? t('organizations.members.leave') : t('organizations.members.remove')}
        message={leaving
          ? t('organizations.members.leaveConfirm', { name: orgName })
          : t('organizations.members.removeConfirm', { name: pending?.displayName ?? '' })}
        confirmLabel={t('organizations.members.confirmYes')}
        cancelLabel={t('organizations.members.confirmNo')}
        destructive
        isBusy={state.busy}
        errorMessage={errorKey ? t(errorKey) : null}
        onCancel={() => setPending(null)}
        onConfirm={() => void confirmRemove()}
      />
    </>
  );
}

function MemberRow(props: {
  readonly member: OrgMember;
  readonly isSelf: boolean;
  readonly canRemove: boolean;
  readonly onRemove: () => void;
}) {
  const { t } = useTranslation();
  const styles = useStyles();
  const { member } = props;
  return (
    <View style={styles.row} testID={`org-member-${member.userId}`}>
      <AvatarInitials name={member.displayName} avatarUrl={member.avatarUrl} size={40} />
      <View style={styles.rowText}>
        <Text style={[styles.name, webTextRtl]} numberOfLines={1}>
          {props.isSelf ? `${member.displayName} ${t('organizations.members.you')}` : member.displayName}
        </Text>
        <Text style={[styles.meta, webTextRtl]}>{`@${member.shareHandle} · ${t(`organizations.roles.${member.role}`)}`}</Text>
      </View>
      {props.canRemove ? (
        <GhostButton
          testID={`org-member-remove-${member.userId}`}
          size="sm"
          label={props.isSelf ? t('organizations.members.leave') : t('organizations.members.remove')}
          onPress={props.onRemove}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  body: { padding: spacing.lg, gap: spacing.md },
  sectionTitle: { ...typography.bodyLarge, ...typography.semiBold, color: colors.textPrimary },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  rowText: { flex: 1 },
  name: { ...typography.body, color: colors.textPrimary },
  meta: { ...typography.caption, color: colors.textSecondary },
}));
