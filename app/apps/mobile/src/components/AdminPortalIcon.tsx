// Home-feed top-bar shortcut to the Admin Portal (FR-ADMIN-011 AC6).
// Same visibility gate as the Settings "Admin Portal" row (AC3): at least one active
// admin role. UI convenience only — AdminGate and the server RPCs re-check the actor.
import React from 'react';
import { TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { iconSize, makeUseStyles, spacing, useTheme } from '@kc/ui';
import { useAdminRoles } from '../hooks/useAdminRoles';

export function AdminPortalIcon() {
  const router = useRouter();
  const { t } = useTranslation();
  const styles = useStyles();
  const { colors } = useTheme();
  const { roles } = useAdminRoles();
  if (roles.length === 0) return null;

  return (
    <TouchableOpacity
      testID="topbar-admin-portal"
      style={styles.iconBtn}
      onPress={() => router.push('/(admin)')}
      accessibilityRole="button"
      accessibilityLabel={t('admin.settingsRow')}
    >
      <Ionicons name="shield-checkmark-outline" size={iconSize['2xl']} color={colors.textPrimary} />
    </TouchableOpacity>
  );
}

const useStyles = makeUseStyles(() => ({
  iconBtn: { padding: spacing.xs },
}));
