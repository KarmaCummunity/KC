// Settings → WhatsApp bot link (#1090). Parked: the bot and its link codes wait for the
// `integrations` module, which the production baseline leaves empty (M22). The settings row is
// hidden (src/lib/parkedFeatures.ts); a direct link shows the "not available yet" state. The
// previous link-code screen is in git history and returns with the integrations module.
import React from 'react';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@kc/ui';
import { useShellStackScreenOptions } from '../../src/navigation/shellStackScreenOptions';
import { ParkedFeatureNotice } from '../../src/components/ParkedFeatureNotice';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

export default function WhatsAppLinkScreen() {
  const shellStackScreenOptions = useShellStackScreenOptions();
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <>
      <Stack.Screen
        options={{
          ...shellStackScreenOptions,
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.primary,
          headerTitle: t('settings.whatsapp.title'),
        }}
      />
      <ParkedFeatureNotice testID="settings-whatsapp-parked" />
    </>
  );
}
