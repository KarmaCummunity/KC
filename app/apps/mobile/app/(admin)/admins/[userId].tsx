// app/apps/mobile/app/(admin)/admins/[userId].tsx
// FR-ADMIN-022 / FR-ADMIN-025 / FR-ADMIN-030 — the admin person screen: the
// single place to manage one person end to end. Opens for any user (role
// holders from the team views, anyone from the users search) and shows:
//   • their roles, with add / change / revoke within the viewer's authority;
//   • the permissions those roles carry (role-derived only, D85);
//   • their direct manager and reports, with assign / change manager.
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { hasPermission } from '@kc/domain';
import { iconSize, makeUseStyles, radius, spacing, Text, typography, useTheme } from '@kc/ui';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { useAdminPerson } from '../../../src/hooks/useAdminPerson';
import { useUserBasics } from '../../../src/hooks/useUserBasics';
import { AvatarInitials } from '../../../src/components/AvatarInitials';
import { PersonRolesSection } from '../../../src/components/admin/admins/PersonRolesSection';
import { RolePermissionsSection } from '../../../src/components/admin/admins/RolePermissionsSection';
import { AdminManagerSections } from '../../../src/components/admin/admins/AdminManagerSections';
import { rowDirectionStart } from '../../../src/lib/rtlLayout';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { useAdminScreenTitle } from '../../../src/components/admin/useAdminScreenTitle';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

export default function AdminPersonScreen() {
  const styles = useStyles();
  const L = useLocaleBundle();
  const { colors } = useTheme();
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const { person, isLoading } = useAdminPerson(userId);
  // People without a visible grant still open, from their user record.
  const basics = useUserBasics(userId, !isLoading && person === null);
  const displayName = person?.displayName ?? basics.data?.displayName ?? null;
  useAdminScreenTitle(displayName ?? L.admin.admins.detail.title);

  if (rolesLoading || isLoading || basics.isLoading) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (!hasPermission(roles, 'admins.view')) {
    return <View style={styles.center}><Text style={styles.title}>{L.admin.admins.forbiddenTitle}</Text></View>;
  }
  const avatarUrl = person?.avatarUrl ?? basics.data?.avatarUrl ?? null;
  if (!person && !basics.data) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{L.admin.admins.detail.notFound}</Text>
      </View>
    );
  }

  const name = displayName ?? L.admin.admins.row.unnamed;
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <AvatarInitials name={name} avatarUrl={avatarUrl} size={64} />
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/user/${userId}`)}
          style={styles.profileBtn}
        >
          <Ionicons name="person-circle-outline" size={iconSize.md} color={colors.primary} />
          <Text style={styles.profileBtnText}>{L.admin.admins.detail.viewProfile}</Text>
        </Pressable>
      </View>

      <PersonRolesSection userId={userId} personName={name} grants={person?.grants ?? []} />
      <RolePermissionsSection roles={person?.activeRoles ?? []} />
      <AdminManagerSections userId={userId} canManage={hasPermission(roles, 'admins.set_manager')} />
    </ScrollView>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root:    { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.base, gap: spacing.sm, width: '100%', maxWidth: 760, alignSelf: 'center' },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  title:   { ...typography.body, ...typography.bold, color: colors.textPrimary, textAlign: 'center' },
  hero:    { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  name:    { ...typography.h3, ...typography.extraBold, color: colors.textPrimary },
  profileBtn: {
    flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.base, paddingVertical: spacing.sm, borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
  },
  profileBtnText: { ...typography.bodySmall, ...typography.bold, color: colors.primary },
}));
