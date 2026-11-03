// FR-DONATE-011 — "Support KC directly" card (D20). Hosted on the Money hub and,
// through `DonationSupportCard`, on About + Settings (FR-DONATE-010).
// Every option opens a licensed provider's hosted page outside the app, so no
// payment data is handled here and store rules on donations are respected.
import React, { useCallback } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { iconSize, makeUseStyles, useTheme, Text } from '@kc/ui';
import { warmPromptCardBase } from '../warmPromptCardStyles';
import { aboutOpenExternalUrl } from '../../features/about-landing/aboutOpenExternalUrl';
import { useKcSupportOptions } from '../../hooks/useKcSupportOptions';
import { SupportKcOptions } from './SupportKcOptions';
import { SupportKcDisclosure } from './SupportKcDisclosure';

export interface SupportKcCardProps {
  /** i18n key of the heading; defaults to the Money-hub wording. */
  readonly titleKey?: string;
  /** i18n key of the tagline under the heading. */
  readonly taglineKey?: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

const useStyles = makeUseStyles((theme) => {
  const base = warmPromptCardBase(theme);
  return { card: base.card, iconBadge: base.iconBadge, title: base.title, tagline: base.bodyLine };
});

export function SupportKcCard({
  titleKey = 'supportKc.title',
  taglineKey = 'supportKc.tagline',
  style,
  testID = 'support-kc-card',
}: SupportKcCardProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const { data, isLoading } = useKcSupportOptions();

  const openChannel = useCallback(
    (url: string) => void aboutOpenExternalUrl(url, t('supportKc.linkError')),
    [t],
  );

  return (
    <View style={[styles.card, style]} testID={testID}>
      <View style={styles.iconBadge}>
        <Ionicons name="heart" size={iconSize['2xl']} color={colors.textInverse} />
      </View>
      <Text style={styles.title} accessibilityRole="header">{t(titleKey)}</Text>
      <Text style={styles.tagline}>{t(taglineKey)}</Text>
      <SupportKcOptions options={data} loading={isLoading} onOpen={openChannel} />
      <SupportKcDisclosure hasStandingOrder={Boolean(data?.standingOrder)} />
    </View>
  );
}
