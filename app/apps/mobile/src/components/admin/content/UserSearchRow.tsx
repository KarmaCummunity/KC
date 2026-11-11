// app/apps/mobile/src/components/admin/content/UserSearchRow.tsx
// FR-ADMIN-019 — single row for the admin users search.
// V2-ADMIN-USERS-6 — inline "Ban" affordance routes the admin through the
// existing FR-ADMIN-004 BanUserModal without forcing them through the user
// profile screen first.
// FR-ADMIN-030 — inline "Roles" opens the admin person screen, where any user
// can be given a role, moved or re-roled.
import { memo, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  type AdminPermission,
  type AdminRole,
  hasPermission,
  type AdminUserSearchResult,
} from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { Chip } from '../../ui/Chip';
import { useAdminRoles } from '../../../hooks/useAdminRoles';
import { useCityName } from '../../../hooks/useCityName';
import { BanUserModal } from '../../profile/BanUserModal';
import { rowDirectionStart, textAlignStart } from '../../../lib/rtlLayout';
import { useLocaleBundle, type LocaleBundle } from '../../../i18n/useLocaleBundle';

export interface UserSearchRowProps {
  readonly row: AdminUserSearchResult;
}

function statusTone(status: string): 'success' | 'warning' | 'error' | 'muted' {
  if (status === 'active') return 'success';
  if (status === 'pending_verification') return 'warning';
  if (status === 'banned') return 'error';
  if (status === 'pending_deletion') return 'warning';
  return 'muted';
}

// Banning is permanent in MVP (FR-ADMIN-004 AC3): offered to an account that is not banned yet
// and not leaving — `admin_ban_user` refuses an account under deletion (0696).
function canShowBanButton(status: string): boolean {
  return status !== 'banned' && status !== 'pending_deletion';
}

function UserSearchRowInner({ row }: UserSearchRowProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const tone = statusTone(row.accountStatus);
  // The search returns the city id; its name comes from the cached city list.
  const cityName = useCityName(row.cityId);
  const { roles } = useAdminRoles();
  const can = (perm: AdminPermission) => hasPermission(roles as readonly AdminRole[], perm);
  const showBan = can('reports.permanent_ban') && canShowBanButton(row.accountStatus);
  const showRoles = can('admins.view');
  const [banOpen, setBanOpen] = useState(false);

  return (
    <>
      <Pressable
        style={styles.root}
        onPress={() => {
          if (row.shareHandle) {
            router.push({ pathname: '/user/[handle]', params: { handle: row.shareHandle } });
          }
        }}
      >
        <View style={styles.main}>
          <Text style={styles.name} numberOfLines={1}>
            {row.displayName ?? L.admin.admins.row.unnamed}
          </Text>
          {row.shareHandle && <Text style={styles.handle} numberOfLines={1}>@{row.shareHandle}</Text>}
          {cityName && <Text style={styles.meta} numberOfLines={1}>{cityName}</Text>}
        </View>
        <Chip
          variant="tag"
          tone={tone}
          label={
            L.admin.content.userStatus[row.accountStatus as keyof LocaleBundle['admin']['content']['userStatus']]
              ?? row.accountStatus
          }
          size="sm"
        />
        {showRoles && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={L.admin.admins.team.manageFromSearch}
            onPress={(e) => {
              e.stopPropagation();
              router.push({ pathname: '/(admin)/admins/[userId]', params: { userId: row.userId } });
            }}
            style={styles.rolesBtn}
          >
            <Text style={styles.rolesText}>{L.admin.admins.team.manageFromSearch}</Text>
          </Pressable>
        )}
        {showBan && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={L.admin.content.userInline.ban}
            onPress={(e) => {
              e.stopPropagation();
              setBanOpen(true);
            }}
            style={styles.actionBtn}
          >
            <Text style={styles.actionText}>{L.admin.content.userInline.ban}</Text>
          </Pressable>
        )}
      </Pressable>
      {showBan && (
        <BanUserModal
          targetUserId={row.userId}
          visible={banOpen}
          onClose={() => setBanOpen(false)}
        />
      )}
    </>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root: {
    flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md, paddingHorizontal: spacing.base,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  main:        { flex: 1, gap: spacing.xs },
  name:        { ...typography.body, ...typography.semiBold, color: colors.textPrimary, textAlign: textAlignStart() },
  handle:      { ...typography.caption, color: colors.primary, textAlign: textAlignStart() },
  meta:        { ...typography.caption, color: colors.textSecondary, textAlign: textAlignStart() },
  rolesBtn: {
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm,
    backgroundColor: colors.primarySurface,
  },
  rolesText:   { ...typography.caption, ...typography.bold, color: colors.primary },
  actionBtn: {
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm,
    backgroundColor: colors.errorLight,
  },
  actionText:  { ...typography.caption, ...typography.bold, color: colors.error },
}));

export const UserSearchRow = memo(UserSearchRowInner);
