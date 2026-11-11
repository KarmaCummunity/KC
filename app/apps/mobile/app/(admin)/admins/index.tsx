// app/apps/mobile/app/(admin)/admins/index.tsx
// FR-ADMIN-015 / FR-ADMIN-016 / FR-ADMIN-022 / FR-ADMIN-025 / FR-ADMIN-028 /
// FR-ADMIN-030 — Admin RBAC screen.
//
// Thin orchestrator: a layers/list/tree view toggle + the grant affordance. The
// three view bodies (layered pyramid, cards list, hierarchy tree) own their own
// data and live in AdminsLayersView / AdminsListView / AdminsTreeView. Every
// person opens the person screen, where roles and managers are managed.
//
// Visibility per PERMISSION_MATRIX['admins.view'] (the server scopes the data):
//   - super_admin:             every org; grant / change / revoke anywhere.
//   - org admins and managers: their own org; manage within their authority (D86).
//   - moderator:               the platform team, read-only.
//   - support, org members:    no access (denial card).
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { type AdminPermission, type AdminRole, hasPermission } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography, useBreakpoint } from '@kc/ui';
import { PrimaryButton } from '../../../src/components/ui/Buttons';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { rowDirectionStart } from '../../../src/lib/rtlLayout';
import { GrantRoleModal } from '../../../src/components/admin/admins/GrantRoleModal';
import { AdminsListView } from '../../../src/components/admin/admins/AdminsListView';
import { AdminsTreeView } from '../../../src/components/admin/admins/AdminsTreeView';
import { AdminsLayersView } from '../../../src/components/admin/admins/layers/AdminsLayersView';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

type ViewMode = 'layers' | 'list' | 'tree';
// The layered pyramid is the overview and opens first (FR-ADMIN-028 AC5).
const VIEW_MODES: readonly ViewMode[] = ['layers', 'list', 'tree'];

export default function AdminsScreen() {
  const styles = useStyles();
  const L = useLocaleBundle();
  const router = useRouter();
  const isWide = useBreakpoint() !== 'mobile';
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const [grantOpen, setGrantOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('layers');

  const can = (perm: AdminPermission) => hasPermission(roles as readonly AdminRole[], perm);

  if (rolesLoading) {
    return <View style={styles.center}><Text>{L.admin.admins.loading}</Text></View>;
  }
  if (!can('admins.view')) {
    return (
      <View style={styles.center}>
        <Text style={styles.deniedTitle}>{L.admin.admins.forbiddenTitle}</Text>
        <Text style={styles.deniedHint}>{L.admin.admins.forbiddenHint}</Text>
      </View>
    );
  }

  const canGrant = can('admins.grant_role');
  const openDetail = (userId: string) =>
    router.push({ pathname: '/(admin)/admins/[userId]', params: { userId } });
  const viewLabel: Readonly<Record<ViewMode, string>> = {
    layers: L.admin.admins.viewLayers,
    list:   L.admin.admins.viewList,
    tree:   L.admin.admins.viewTree,
  };

  return (
    <View style={styles.root}>
      <View style={styles.headerControls}>
        <View style={styles.segment}>
          {VIEW_MODES.map((m) => (
            <Pressable
              key={m}
              accessibilityRole="button"
              accessibilityState={{ selected: viewMode === m }}
              onPress={() => setViewMode(m)}
              style={[styles.segmentBtn, viewMode === m && styles.segmentBtnActive]}
            >
              <Text style={[styles.segmentText, viewMode === m && styles.segmentTextActive]}>
                {viewLabel[m]}
              </Text>
            </Pressable>
          ))}
        </View>
        {canGrant && (
          <PrimaryButton testID="admin-grant" label={L.admin.admins.grantBtn} size="sm" onPress={() => setGrantOpen(true)} />
        )}
      </View>

      {viewMode === 'layers' && <AdminsLayersView isWide={isWide} onSelect={openDetail} />}
      {viewMode === 'list' && <AdminsListView isWide={isWide} onSelect={openDetail} />}
      {viewMode === 'tree' && (
        <AdminsTreeView isWide={isWide} isSuper={roles.includes('super_admin')} onSelect={openDetail} />
      )}

      {canGrant && <GrantRoleModal visible={grantOpen} onClose={() => setGrantOpen(false)} />}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root:        { flex: 1, backgroundColor: colors.background },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  deniedTitle: { ...typography.h3, ...typography.bold, color: colors.textPrimary },
  deniedHint:  { ...typography.bodySmall, opacity: 0.6, textAlign: 'center', color: colors.textSecondary },
  // Wraps so three view tabs + the grant button never overflow a phone width.
  headerControls: {
    flexDirection: rowDirectionStart, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.base, paddingVertical: spacing.md, gap: spacing.md,
  },
  segment:     { flexDirection: rowDirectionStart, backgroundColor: colors.surface, borderRadius: radius.full, padding: spacing.xs },
  segmentBtn:  { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.full },
  segmentBtnActive: { backgroundColor: colors.primary },
  segmentText: { ...typography.bodySmall, ...typography.bold, color: colors.textSecondary },
  segmentTextActive: { color: colors.textInverse },
}));
