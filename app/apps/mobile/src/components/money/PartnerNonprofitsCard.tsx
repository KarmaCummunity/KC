// FR-DONATE-003 AC2–AC4 — link-out to the partner donation platform jgive (D37).
// Opens in the external browser; never an in-app WebView.
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { Card } from '../ui/Card';
import { SecondaryButton } from '../ui/Buttons';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { aboutOpenExternalUrl } from '../../features/about-landing/aboutOpenExternalUrl';

const JGIVE_URL = 'https://www.jgive.com';

const useStyles = makeUseStyles(({ colors }) => ({
  card: { gap: spacing.md },
  title: { ...typography.h3, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  body: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
}));

export function PartnerNonprofitsCard() {
  const { t } = useTranslation();
  const styles = useStyles();
  const openJgive = useCallback(
    () => void aboutOpenExternalUrl(JGIVE_URL, t('donations.moneyScreen.linkErrorBody')),
    [t],
  );
  return (
    <Card padding="lg" style={styles.card} testID="partner-nonprofits-card">
      <Text style={styles.title} accessibilityRole="header">{t('supportKc.partnersTitle')}</Text>
      <Text style={styles.body}>{t('supportKc.partnersBody')}</Text>
      <SecondaryButton
        label={t('donations.moneyScreen.openLink')}
        icon="open-outline"
        onPress={openJgive}
        testID="partner-nonprofits-jgive"
        fullWidth
      />
    </Card>
  );
}
