// app/apps/mobile/src/components/admin/admins/RoleBadge.tsx
// FR-ADMIN-022 — compact role pill used on the unified admin card and detail.
import { StyleSheet, View } from 'react-native';
import type { AdminRole } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography, useTheme, type ColorToken } from '@kc/ui';
import { rowDirectionStart } from '../../../lib/rtlLayout';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

// Accent per role token (spec 17 §4.3: role colours live in brand tokens and meet AA in both palettes).
const ROLE_TOKEN: Readonly<Record<AdminRole, ColorToken>> = {
  super_admin:       'roleSuperAdmin',
  moderator:         'roleModerator',
  support:           'roleSupport',
  operators_manager: 'roleOperatorsManager',
  operator:          'roleOperator',
  org_admin:         'roleOrgAdmin',
  org_manager:       'roleOrgManager',
  volunteer_manager: 'roleVolunteerManager',
  org_employee:      'roleOrgEmployee',
  org_volunteer:     'roleOrgVolunteer',
  // The baseline roles share the accent of their nearest role (no new brand colours):
  // the platform admin that of the super admin, the finance roles those of the org's
  // manager and employee, the legacy volunteer that of the org volunteer.
  admin:             'roleSuperAdmin',
  org_treasurer:     'roleOrgManager',
  org_accountant:    'roleOrgEmployee',
  volunteer:         'roleOrgVolunteer',
};

export interface RoleBadgeProps {
  readonly role: AdminRole;
  readonly muted?: boolean;
}

export function RoleBadge({ role, muted }: RoleBadgeProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const L = useLocaleBundle();
  const accent = colors[ROLE_TOKEN[role]];
  return (
    <View style={[styles.badge, { borderColor: accent }, muted && styles.muted]}>
      <View style={[styles.dot, { backgroundColor: accent }]} />
      <Text style={styles.text} numberOfLines={1}>
        {L.admin.roles[role]}
      </Text>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  badge: {
    flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth,
  },
  muted: { opacity: 0.5 },
  dot:   { width: 6, height: 6, borderRadius: radius.full },
  text:  { ...typography.caption, ...typography.bold, color: colors.textPrimary },
}));
