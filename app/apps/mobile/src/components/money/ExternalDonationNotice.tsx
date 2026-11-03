import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import type { ExternalDonationKind } from '../../config/featureFlags';
import { useExternalDonations } from '../../hooks/useExternalDonations';

const useStyles = makeUseStyles(({ colors }) => ({
  body: { padding: spacing.lg, gap: spacing.md },
  text: { ...typography.body, color: colors.textSecondary },
  btn: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center' as const },
  btnText: { ...typography.button, color: colors.textInverse },
}));

/** Shown instead of the in-app payment form on iOS while ios_in_app_donations is off. */
export function ExternalDonationNotice({
  kind,
  orgId,
  listingId,
}: {
  kind: ExternalDonationKind;
  orgId: string;
  listingId?: string | null;
}) {
  const { t } = useTranslation();
  const styles = useStyles();
  const { openExternal } = useExternalDonations();
  return (
    <View style={styles.body} testID="external-donation-notice">
      <Text style={styles.text}>{t('moneyPayments.externalNotice')}</Text>
      <Pressable
        style={styles.btn}
        accessibilityRole="link"
        onPress={() => void openExternal(kind, orgId, listingId)}
      >
        <Text style={styles.btnText}>{t('moneyPayments.continueInBrowser')}</Text>
      </Pressable>
    </View>
  );
}
