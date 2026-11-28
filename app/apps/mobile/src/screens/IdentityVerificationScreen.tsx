// FR-VERIFY-003 / FR-VERIFY-004 / FR-VERIFY-005 — identity verification status page and the
// entry to the provider flow. A complete profile (level 1) comes first; from there the member
// reads the explainer, consents and opens the provider-hosted document + selfie check.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { canStartIdentityVerification } from '@kc/domain';
import { spacing, Text } from '@kc/ui';
import { Screen } from '../components/ui/Screen';
import { PrimaryButton, SecondaryButton } from '../components/ui/Buttons';
import { useShellStackScreenOptions } from '../navigation/shellStackScreenOptions';
import { useShellTabBarScrollInset } from '../navigation/useShellTabBarVisibility';
import { useViewerVerificationLevel } from '../hooks/useViewerVerificationLevel';
import { useIdentityVerificationStatus } from '../hooks/useIdentityVerification';
import { useCreatePostStyles } from './tabs/create.styles';
import { VerificationBadge } from '../components/VerificationBadge';
import { IdentityVerificationStart } from '../components/identityVerification/IdentityVerificationStart';
import { identityStatusText } from '../components/identityVerification/identityStatusText';

/** Status, its reason and, when allowed, the explainer with the start button (level 1 members). */
function IdentityVerificationProgress() {
  const { t, i18n } = useTranslation();
  const styles = useCreatePostStyles();
  const statusQuery = useIdentityVerificationStatus();
  const summary = statusQuery.data;
  if (!summary) return null;

  const { statusKey, reasonKey } = identityStatusText(summary);
  const retry = summary.status === 'declined' || summary.status === 'resubmit' || summary.status === 'expired';
  return (
    <>
      <View style={styles.section} testID={`identity-status-${summary.status}`}>
        <Text style={styles.sectionHint}>{t(statusKey)}</Text>
        {reasonKey ? <Text style={styles.sectionHint}>{t(reasonKey)}</Text> : null}
        {summary.status === 'review' || summary.status === 'in_progress' ? (
          <SecondaryButton label={t('verification.identity.refresh')} onPress={() => void statusQuery.refetch()} />
        ) : null}
      </View>
      {canStartIdentityVerification(summary.status) ? (
        <IdentityVerificationStart labelKey={retry ? 'verification.identity.retry' : 'verification.identity.start'} />
      ) : null}
      {summary.expiresAt && summary.status === 'verified' ? (
        <Text style={styles.sectionHint}>
          {t('verification.identity.expiresOn', { date: new Date(summary.expiresAt).toLocaleDateString(i18n.language) })}
        </Text>
      ) : null}
    </>
  );
}

export function IdentityVerificationScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useCreatePostStyles();
  const shellStackOptions = useShellStackScreenOptions();
  const tabBarPad = useShellTabBarScrollInset();
  const levelQuery = useViewerVerificationLevel();

  const level = levelQuery.data ?? 0;
  const levelLabel =
    level >= 1 ? t(`verification.level.${level}` as 'verification.level.1') : t('verification.identity.levelNone');

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

        {level === 1 ? <IdentityVerificationProgress /> : null}
      </ScrollView>
    </Screen>
  );
}
