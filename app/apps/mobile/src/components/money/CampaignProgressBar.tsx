// FR-ORG-010 — a campaign's progress toward its goal on the nonprofit page. Nothing is drawn for a
// campaign that set no goal; the bar is full at the goal and never overflows past it.
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { shekelsText } from './moneyAmount';

const useStyles = makeUseStyles(({ colors }) => ({
  track: {
    height: 8,
    borderRadius: radius.xs,
    backgroundColor: colors.border,
    overflow: 'hidden' as const,
    marginTop: spacing.xs,
  },
  fill: { height: '100%' as const, backgroundColor: colors.primary, borderRadius: radius.xs },
  label: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
}));

/** Share of the goal raised, 0 to 1; 0 without a goal. */
export function campaignProgressShare(raisedAgorot: number, goalAgorot: number): number {
  if (!(goalAgorot > 0) || !(raisedAgorot > 0)) return 0;
  return Math.min(1, raisedAgorot / goalAgorot);
}

export function CampaignProgressBar({ raisedAgorot, goalAgorot }: { readonly raisedAgorot: number; readonly goalAgorot: number }) {
  const styles = useStyles();
  const { t } = useTranslation();
  if (!(goalAgorot > 0)) return null;
  const share = campaignProgressShare(raisedAgorot, goalAgorot);
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(share * 100) }}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${share * 100}%` }]} />
      </View>
      <Text style={styles.label}>
        {t('moneyPayments.campaignProgress', { raised: shekelsText(raisedAgorot), goal: shekelsText(goalAgorot) })}
      </Text>
    </View>
  );
}
