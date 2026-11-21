// Settings → notifications screen — FR-NOTIF-014, FR-NOTIF-017, FR-SETTINGS-005.
import {
  View,
  ScrollView,
  Pressable,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { isNotificationKindEnabled } from '@kc/domain';
import { Stack } from 'expo-router';
import { makeUseStyles, typography, spacing, radius, Text } from '@kc/ui';
import { useShellStackScreenOptions } from '../../src/navigation/shellStackScreenOptions';
import { rtlTextAlignStart } from '../../src/lib/rtlLayout';
import { webTextRtl, webViewRtl } from '../../src/lib/webRtlStyle';
import { NotificationToggleRow } from '../../src/components/NotificationToggleRow';
import { QuietHoursSection } from '../../src/components/settings/QuietHoursSection';
import { useNotificationPreferences } from '../../src/hooks/useNotificationPreferences';
import { useDevicePushPermission } from '../../src/lib/notifications/useDevicePushPermission';
import { registerCurrentDeviceIfPermitted } from '../../src/lib/notifications/register';
import { useAuthStore } from '../../src/store/authStore';
import { container } from '../../src/lib/container';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

const useStyles = makeUseStyles(({ colors }) => ({
  scrollContent: { ...webViewRtl },
  sectionHeader: {
    ...typography.caption,
    color: colors.textSecondary,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    textAlign: rtlTextAlignStart,
    width: '100%',
    ...webTextRtl,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    gap: spacing.sm,
    justifyContent: 'space-between',
    ...webViewRtl,
  },
  statusText: {
    ...typography.body,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    flex: 1,
    ...webTextRtl,
  },
  button: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.success,
    borderRadius: radius.sm,
  },
  buttonText: { ...typography.body, color: colors.textInverse },
}));

export default function NotificationSettingsScreen() {
  const shellStackScreenOptions = useShellStackScreenOptions();
  const styles = useStyles();
  const { t } = useTranslation();
  const userId = useAuthStore((state) => state.session?.userId ?? null);
  const permission = useDevicePushPermission(async () => {
    if (userId) await registerCurrentDeviceIfPermitted(userId, { deviceRepo: container.deviceRepo });
  }, userId);
  const permissionKey = {
    loading: 'permissionLoading', granted: 'permissionGranted', askable: 'permissionNotRequested',
    blocked: 'permissionDenied', error: 'permissionError',
  } as const;

  const { prefs, update } = useNotificationPreferences();

  return (
    <>
      <Stack.Screen
        options={{
          ...shellStackScreenOptions,
          headerTitle: t('notifications.settingsTitle'),
        }}
      />
      <ScrollView testID="notification-settings-screen" contentContainerStyle={styles.scrollContent}>
        <NotificationToggleRow
          label={t('notifications.criticalLabel')}
          caption={t('notifications.criticalCaption')}
          value={prefs.critical}
          onValueChange={(v) => update({ critical: v })}
        />
        <NotificationToggleRow
          label={t('notifications.socialLabel')}
          caption={t('notifications.socialCaption')}
          value={prefs.social}
          onValueChange={(v) => update({ social: v })}
        />
        {/* FR-NOTIF-017: per-type opt-out; covers in-app, push and WhatsApp match alerts. */}
        <NotificationToggleRow
          label={t('notifications.matchSuggestionsLabel')}
          caption={t('notifications.matchSuggestionsCaption')}
          value={isNotificationKindEnabled(prefs, 'match_suggested')}
          onValueChange={(v) => update({ kinds: { match_suggested: v } })}
        />

        <QuietHoursSection value={prefs.quietHours} onChange={(quietHours) => update({ quietHours })} />

        {Platform.OS !== 'web' && (
          <>
            <Text style={styles.sectionHeader}>
              {t('notifications.deviceStatusSection')}
            </Text>
            <View style={styles.statusRow}>
              <Text style={styles.statusText}>
                {t(`notifications.${permissionKey[permission.status]}`)}
              </Text>
              {permission.status !== 'loading' && permission.status !== 'granted' && (
                <Pressable
                  testID="notification-permission-action"
                  accessibilityRole="button"
                  disabled={permission.busy}
                  onPress={() => void permission.enable()}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>
                    {t(permission.status === 'blocked' ? 'notifications.openOsSettings' : permission.status === 'error' ? 'notifications.permissionRetry' : 'notifications.permissionEnable')}
                  </Text>
                </Pressable>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}
