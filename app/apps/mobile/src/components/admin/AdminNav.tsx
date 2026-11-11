// app/apps/mobile/src/components/admin/AdminNav.tsx
// Admin Portal navigation (FR-ADMIN-011). Two variants driven by the layout:
//   - `sidebar` — desktop / tablet web (≥ md): branded vertical rail.
//   - `topbar`  — phone & mobile-web: horizontal scrollable pill bar.
// Entries are filtered by the caller's RBAC so a moderator/support session
// only sees the surfaces they can actually open.
import type { ComponentProps, ReactElement } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { adminChipScroll } from './adminChipScroll';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname, type Href } from 'expo-router';
import { type AdminPermission, type AdminRole, hasPermission } from '@kc/domain';
import { makeUseStyles, radius, spacing, typography, useTheme, Text, iconSize } from '@kc/ui';
import { useAdminRoles } from '../../hooks/useAdminRoles';
import { rowDirectionStart, textAlignStart } from '../../lib/rtlLayout';
import { useLocaleBundle, type LocaleBundle } from '../../i18n/useLocaleBundle';
import { useLaunchSurface } from '../../hooks/useLaunchSurface';
import { ADMIN_DESTINATIONS, type AdminDestination } from '../../lib/admin/adminDestinations';

type IconName = ComponentProps<typeof Ionicons>['name'];

type NavItem = AdminDestination;
const ITEMS = ADMIN_DESTINATIONS;

function normalize(href: string): string {
  // Strip the expo-router group prefix so the literal route matches what
  // usePathname() returns at runtime.
  return href.replace('/(admin)', '/admin').replace(/\/$/, '');
}

export function AdminNav({ variant }: { variant: 'sidebar' | 'topbar' }): ReactElement {
  const pathname = usePathname();
  const { roles } = useAdminRoles();
  const whatsappBotVisible = useLaunchSurface('whatsappBot');
  const { colors } = useTheme();
  const styles = useStyles();
  const L = useLocaleBundle();
  const labels = L.admin.nav;

  const items = ITEMS.filter(
    (it) =>
      (it.key !== 'whatsapp' || whatsappBotVisible) &&
      (it.perm == null || hasPermission(roles as readonly AdminRole[], it.perm)),
  );
  const current = normalize(pathname || '/admin');

  const renderItem = (it: NavItem): ReactElement => {
    // A section stays highlighted on its sub-routes (e.g. money/accounts); the dashboard
    // ('/admin') must match exactly or it would be active everywhere.
    const target = normalize(it.href);
    const active = current === target || (target !== '/admin' && current.startsWith(`${target}/`));
    const base = variant === 'sidebar' ? styles.sideItem : styles.pill;
    const activeStyle = variant === 'sidebar' ? styles.sideItemActive : styles.pillActive;
    return (
      <Pressable
        key={it.key}
        onPress={() => router.push(it.href)}
        accessibilityRole="link"
        accessibilityState={{ selected: active }}
        style={[base, active && activeStyle]}
      >
        <Ionicons
          name={it.icon}
          size={variant === 'sidebar' ? iconSize.lg : iconSize.md}
          color={active ? colors.primary : colors.textSecondary}
        />
        <Text
          style={[styles.label, { color: active ? colors.primaryDark : colors.textPrimary }, active && styles.labelActive]}
          numberOfLines={1}
        >
          {labels[it.key]}
        </Text>
      </Pressable>
    );
  };

  if (variant === 'sidebar') {
    return (
      <View style={styles.sidebar}>
        <View style={styles.brand}>
          <View style={styles.brandMark}>
            <Ionicons name="shield-checkmark" size={iconSize.md} color={colors.textInverse} />
          </View>
          <Text style={styles.brandText} numberOfLines={1}>
            {L.admin.portalTitle}
          </Text>
        </View>
        <View style={styles.sideList}>{items.map(renderItem)}</View>
      </View>
    );
  }

  return (
    <View style={styles.topbarWrap}>
      <ScrollView
        style={adminChipScroll.scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.topbar}
      >
        {items.map(renderItem)}
      </ScrollView>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  // Desktop / tablet rail
  sidebar: {
    width: 248,
    backgroundColor: colors.surface,
    borderStartWidth: 1,
    borderStartColor: colors.border,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    gap: spacing.base,
  },
  brand: {
    flexDirection: rowDirectionStart,
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: { flex: 1, fontSize: typography.bodyLarge.fontSize, ...typography.extraBold, color: colors.textPrimary, textAlign: textAlignStart() },
  sideList: { gap: spacing.xs },
  sideItem: {
    flexDirection: rowDirectionStart,
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  sideItemActive: { backgroundColor: colors.primarySurface },

  // Mobile pill bar
  topbarWrap: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  topbar: { flexDirection: rowDirectionStart, gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  pill: {
    flexDirection: rowDirectionStart,
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.skeleton,
  },
  pillActive: { backgroundColor: colors.primarySurface, borderWidth: 1, borderColor: colors.primaryLight },

  label: { fontSize: typography.body.fontSize, ...typography.medium },
  labelActive: { ...typography.bold },
}));
