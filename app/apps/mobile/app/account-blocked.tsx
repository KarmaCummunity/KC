// FR-MOD-010 AC4 — terminal screen rendered when the account gate denies the user.
// Lives at the top level (outside the (auth) group) so a signed-out user can land
// on it directly after the gate hook signs them out.
import React from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

export { RouteErrorBoundary as ErrorBoundary } from '../src/components/RouteErrorBoundary';

const SUPPORT_EMAIL = 'karmacommunity2.0@gmail.com';

function openSupportMail(t: TFunction) {
  const subject = t('accountBlocked.supportMail.subject');
  const body = t('accountBlocked.supportMail.body');
  const q = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const url = `mailto:${SUPPORT_EMAIL}?${q}`;
  if (Platform.OS === 'web' && globalThis.window !== undefined) {
    globalThis.window.location.assign(url);
    return;
  }
  void Linking.openURL(url);
}

type Reason = 'banned' | 'suspended_admin' | 'suspended_for_false_reports';

function pickContentKey(reason: string | undefined): string {
  switch (reason as Reason | undefined) {
    case 'suspended_admin':
      return 'accountBlocked.suspendedAdmin';
    case 'suspended_for_false_reports':
      return 'accountBlocked.suspendedForFalseReports';
    case 'banned':
    default:
      return 'accountBlocked.banned';
  }
}

export default function AccountBlockedScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const { reason, until } = useLocalSearchParams<{ reason?: string; until?: string }>();
  const contentKey = pickContentKey(reason);

  const formattedUntil = until
    ? new Date(until).toLocaleDateString('he-IL', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';
  const body = t(`${contentKey}.body`, { defaultValue: '' }).replace('{until}', formattedUntil);

  return (
    <>
      <Stack.Screen options={{ headerTitle: '', headerBackVisible: false }} />
      <View style={styles.container}>
        <Text style={styles.title}>{t(`${contentKey}.title`)}</Text>
        <Text style={styles.body}>{body}</Text>
        <Pressable onPress={() => openSupportMail(t)}>
          <Text style={styles.cta}>{t(`${contentKey}.cta`)}</Text>
        </Pressable>
      </View>
    </>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  container: {
    flex: 1,
    padding: spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    gap: spacing.lg,
  },
  title: {
    ...typography.h2,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  cta: {
    ...typography.button,
    color: colors.primary,
    marginTop: spacing.base,
    textDecorationLine: 'underline',
  },
}));
