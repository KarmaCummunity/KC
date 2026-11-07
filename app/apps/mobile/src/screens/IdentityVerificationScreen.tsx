// FR-VERIFY-003 / FR-VERIFY-004 — identity status + dev mock grant (until provider IDV-1).
import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { spacing, Text } from '@kc/ui';
import { Screen } from '../components/ui/Screen';
import { PrimaryButton, SecondaryButton } from '../components/ui/Buttons';
import { useShellStackScreenOptions } from '../navigation/shellStackScreenOptions';
import { useShellTabBarScrollInset } from '../navigation/useShellTabBarVisibility';
import { useViewerVerificationLevel } from '../hooks/useViewerVerificationLevel';
import { useDevMockIdentityAllowed } from '../hooks/useDevMockIdentityVerification';
import { devGrantMockIdentityVerification } from '../services/devIdentityVerification';
import { useAuthStore } from '../store/authStore';
import { useCreatePostStyles } from './tabs/create.styles';
import { VerificationBadge } from '../components/VerificationBadge';

export function IdentityVerificationScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useCreatePostStyles();
  const shellStackOptions = useShellStackScreenOptions();
  const tabBarPad = useShellTabBarScrollInset();
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.session?.userId);
  const levelQuery = useViewerVerificationLevel();
  const mockAllowed = useDevMockIdentityAllowed();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const level = levelQuery.data ?? 0;
  const levelLabel =
    level >= 1 ? t(`verification.level.${level}` as 'verification.level.1') : t('verification.identity.levelNone');

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['viewer-verification', userId] }),
      queryClient.invalidateQueries({ queryKey: ['user-profile', userId] }),
    ]);
  };

  const grantMock = async () => {
    setBusy(true);
    setError(null);
    try {
      await devGrantMockIdentityVerification();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen blobs="off">
      <Stack.Screen options={{ ...shellStackOptions, headerTitle: t('verification.identity.title') }} />
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarPad }]}>
        <View style={styles.section}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <VerificationBadge level={level} />
            <Text style={styles.sectionLabel}>{levelLabel}</Text>
          </View>
        </View>

        {level >= 2 ? (
          <View style={styles.section} testID="identity-verified">
            <Text style={styles.sectionHint}>{t('verification.identity.doneBody')}</Text>
            <SecondaryButton label={t('general.back')} onPress={() => router.back()} />
          </View>
        ) : null}

        {level === 0 ? (
          <View style={styles.section} testID="identity-need-profile">
            <Text style={styles.sectionHint}>{t('verification.identity.needProfile')}</Text>
            <PrimaryButton label={t('verification.nudge.cta')} onPress={() => router.push('/edit-profile')} />
          </View>
        ) : null}

        {level === 1 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('verification.identity.mockTitle')}</Text>
            <Text style={styles.sectionHint}>{t('verification.identity.mockBody')}</Text>
            {mockAllowed.isPending ? <ActivityIndicator /> : null}
            {mockAllowed.data ? (
              <>
                <Text style={styles.sectionHint}>{t('verification.identity.mockWarning')}</Text>
                {error ? <Text style={styles.sectionHint}>{error}</Text> : null}
                <PrimaryButton
                  testID="identity-mock-grant"
                  label={t('verification.identity.mockCta')}
                  loading={busy}
                  onPress={() => void grantMock()}
                />
              </>
            ) : (
              <Text style={styles.sectionHint}>{t('verification.identity.providerSoon')}</Text>
            )}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
