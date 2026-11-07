// Settings screen stub — SRS §3.5, FR-AUTH-017 (logout)
import React from 'react';
import { View, ScrollView } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PlatformSwitch, spacing, Text } from '@kc/ui';
import { useShellStackScreenOptions } from '../src/navigation/shellStackScreenOptions';
import { useShellTabBarScrollInset } from '../src/navigation/useShellTabBarVisibility';
import { useIsSuperAdmin } from '../src/hooks/useIsSuperAdmin';
import { useAdminRoles } from '../src/hooks/useAdminRoles';
import { useSettingsAccountActions } from '../src/hooks/useSettingsAccountActions';
import { container } from '../src/lib/container';
import { useAuthStore } from '../src/store/authStore';
import { useChatStore } from '../src/store/chatStore';
import { DeleteAccountConfirmModal } from '../src/components/DeleteAccountConfirmModal';
import { DeleteAccountSuccessOverlay } from '../src/components/DeleteAccountSuccessOverlay';
import { DonationSupportCard } from '../src/components/DonationSupportCard';
import { SettingsAboutCard } from '../src/components/SettingsAboutCard';
import { SettingsScreenRow } from '../src/components/SettingsScreenRow';
import { ConfirmActionModal } from '../src/components/post/ConfirmActionModal';
import { usePrivateProfileToggle } from '../src/hooks/usePrivateProfileToggle';
import { useActiveStatusSetting } from '../src/hooks/useActiveStatusSetting';
import { useSettingsScreenStyles } from '../src/screens/settings.styles';
import { effectiveVerificationLevel } from '@kc/domain';
import { getUserRepo } from '../src/services/userComposition';

export { RouteErrorBoundary as ErrorBoundary } from '../src/components/RouteErrorBoundary';
/** Metro `__DEV__` is false in release; set `EXPO_PUBLIC_DEV_SETTINGS_TOOLS=1` for internal builds only. */
const SHOW_SETTINGS_DEBUG_TOOLS =
  __DEV__ || process.env.EXPO_PUBLIC_DEV_SETTINGS_TOOLS === '1';

export default function SettingsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const styles = useSettingsScreenStyles();
  const shellStackOptions = useShellStackScreenOptions();
  const tabBarPad = useShellTabBarScrollInset();
  const session = useAuthStore((s) => s.session);
  const userId = session?.userId;
  const userQuery = useQuery({
    queryKey: ['user-profile', userId],
    queryFn: () => getUserRepo().findById(userId!),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000, // PERF-3: profile (self) — edit-profile invalidates explicitly
  });
  const showFollowRequests = userQuery.data?.privacyMode === 'Private';
  const { isPrivate, canToggle, onToggle, confirmModal } = usePrivateProfileToggle(userId);
  const activeStatus = useActiveStatusSetting(userId);
  const isSuperAdmin = useIsSuperAdmin();
  const { roles: adminRoles } = useAdminRoles();
  const queryClient = useQueryClient();
  const [hardRefreshing, setHardRefreshing] = React.useState(false);
  const {
    signingOut,
    resettingOnboarding,
    deleteModalVisible,
    setDeleteModalVisible,
    deleteSuccessVisible,
    handleDeleteConfirm,
    handleResetOnboarding,
    handleSignOut,
  } = useSettingsAccountActions();

  // Dev-only "simulate hard refresh" (FR-CHAT-012 verification aid).
  const handleSimulateHardRefresh = async () => {
    if (!session?.userId || hardRefreshing) return;
    setHardRefreshing(true);
    try {
      useChatStore.getState().resetOnSignOut();
      queryClient.clear();
      await useChatStore.getState().startInboxSub(
        session.userId,
        container.chatRepo,
        container.chatRealtime,
      );
    } finally {
      setHardRefreshing(false);
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          ...shellStackOptions,
          headerTitle: t('settings.title'),
        }}
      />

      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarPad }]}>
        <View style={styles.supportCardWrap}>
          <DonationSupportCard />
        </View>

        <View style={styles.supportCardWrap}>
          <SettingsAboutCard />
        </View>

        <Text style={styles.sectionTitle}>{t('settings.account')}</Text>
        <View style={styles.section}>
          <SettingsScreenRow
            label={t('settings.accountDetails')}
            icon="person-outline"
            onPress={() => router.push('/edit-profile')}
          />
          {userQuery.data && effectiveVerificationLevel(userQuery.data) < 2 ? (
            <SettingsScreenRow
              testID="settings-row-identity-verification"
              label={t('verification.identity.settingsRow')}
              icon="shield-checkmark-outline"
              onPress={() => router.push('/identity-verification')}
            />
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>{t('settings.appearance')}</Text>
        <View style={styles.section}>
          <SettingsScreenRow
            label={t('settings.appearance')}
            icon="contrast-outline"
            onPress={() => router.push('/settings/appearance')}
          />
        </View>

        <Text style={styles.sectionTitle}>{t('settings.language')}</Text>
        <View style={styles.section}>
          <SettingsScreenRow
            label={t('settings.language')}
            icon="globe-outline"
            onPress={() => router.push('/settings/language')}
          />
          <SettingsScreenRow
            label={t('settings.whatsappRow')}
            icon="logo-whatsapp"
            onPress={() => router.push('/settings/whatsapp')}
          />
        </View>

        <Text style={styles.sectionTitle}>{t('settings.notifications')}</Text>
        <View style={styles.section}>
          <SettingsScreenRow
            testID="settings-row-notifications"
            label={t('settings.notifications')}
            icon="notifications-outline"
            onPress={() => router.push('/settings/notifications')}
          />
          <SettingsScreenRow
            label={t('feedSettings.settingsRow')}
            icon="options-outline"
            onPress={() => router.push('/settings/feed')}
          />
        </View>

        <Text style={styles.sectionTitle}>{t('settings.privacy')}</Text>
        <View style={styles.section}>
          <SettingsScreenRow
            label={t('settings.privateProfileToggle')}
            icon="lock-closed-outline"
            rightElement={
              <PlatformSwitch
                value={isPrivate}
                onValueChange={onToggle}
                disabled={!canToggle}
              />
            }
          />
          <SettingsScreenRow
            label={t('settings.activeStatusToggle')}
            icon="radio-button-on-outline"
            rightElement={
              <PlatformSwitch
                value={activeStatus.enabled !== false}
                onValueChange={activeStatus.setEnabled}
                disabled={activeStatus.loading || activeStatus.saving}
                accessibilityLabel={t('settings.activeStatusHint')}
              />
            }
          />
          {showFollowRequests ? (
            <SettingsScreenRow
              label={t('settings.followRequests')}
              icon="people-outline"
              onPress={() => router.push('/settings/follow-requests')}
            />
          ) : null}
          {/* FR-MOD-004 AC1 — the only way back to a blocked member (their profile is hidden). */}
          <SettingsScreenRow
            label={t('moderation.block.listTitle')}
            icon="ban-outline"
            onPress={() => router.push('/settings/blocked-users')}
          />
        </View>

        <Text style={styles.sectionTitle}>{t('settings.statsSection')}</Text>
        <View style={styles.section}>
          <SettingsScreenRow
            label={t('settings.stats')}
            icon="stats-chart-outline"
            onPress={() => router.push('/stats')}
          />
        </View>

        <Text style={styles.sectionTitle}>{t('survey.entryTitle')}</Text>
        <View style={styles.section}>
          <SettingsScreenRow
            label={t('survey.entryTitle')}
            icon="clipboard-outline"
            onPress={() => router.push('/settings/surveys')}
          />
        </View>

        <Text style={styles.sectionTitle}>{t('settings.support')}</Text>
        <View style={styles.section}>
          <SettingsScreenRow
            label={t('settings.reportIssue')}
            icon="alert-circle-outline"
            onPress={() => router.push('/settings/report-issue')}
          />
          {isSuperAdmin ? (
            <SettingsScreenRow
              label={t('audit.title')}
              icon="document-text-outline"
              onPress={() => router.push('/settings/audit')}
            />
          ) : null}
          {adminRoles.length > 0 ? (
            <SettingsScreenRow
              label={t('admin.settingsRow')}
              icon="shield-checkmark-outline"
              onPress={() => router.push('/(admin)')}
            />
          ) : null}
          <SettingsScreenRow
            label={t('settings.termsOfService')}
            icon="document-text-outline"
            onPress={() => router.push('/legal/terms')}
          />
          <SettingsScreenRow
            label={t('settings.privacyPolicy')}
            icon="shield-checkmark-outline"
            onPress={() => router.push('/legal/privacy')}
          />
        </View>

        {SHOW_SETTINGS_DEBUG_TOOLS && (
          <>
            <Text style={styles.sectionTitle}>{t('settings.devTools')}</Text>
            <View style={styles.section}>
              <SettingsScreenRow
                label={resettingOnboarding ? t('settings.resetting') : t('settings.resetOnboarding')}
                icon="refresh-outline"
                onPress={handleResetOnboarding}
                disabled={resettingOnboarding}
              />
              <SettingsScreenRow
                label={hardRefreshing ? t('settings.simulatingHardRefresh') : t('settings.simulateHardRefresh')}
                icon="reload-outline"
                onPress={handleSimulateHardRefresh}
                disabled={hardRefreshing}
              />
            </View>
          </>
        )}

        <View style={[styles.section, { marginTop: spacing.sm }]}>
          <SettingsScreenRow
            label={signingOut ? t('settings.loggingOut') : t('settings.logout')}
            icon="log-out-outline"
            onPress={handleSignOut}
            disabled={signingOut}
          />
          <SettingsScreenRow
            label={t('settings.deleteAccount')}
            icon="trash-outline"
            destructive
            onPress={() => setDeleteModalVisible(true)}
          />
        </View>

        <Text style={styles.version}>{t('settings.version')} v0.1.0</Text>
      </ScrollView>

      {confirmModal ? (
        <ConfirmActionModal
          visible={confirmModal.visible}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          isBusy={confirmModal.isBusy}
          onCancel={confirmModal.onCancel}
          onConfirm={confirmModal.onConfirm}
        />
      ) : null}

      <DeleteAccountConfirmModal
        visible={deleteModalVisible}
        accountStatus={null}
        onCancel={() => setDeleteModalVisible(false)}
        onConfirm={handleDeleteConfirm}
      />
      <DeleteAccountSuccessOverlay visible={deleteSuccessVisible} />
    </View>
  );
}
