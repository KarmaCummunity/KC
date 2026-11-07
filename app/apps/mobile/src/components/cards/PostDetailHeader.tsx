// Post / listing detail header in the same design language as the base post card (KcCard):
// type pill (give/request tone) + category chip + optional closed chip, then the title.
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { cleanDisplayTitle } from '../../lib/displayTitle';

interface Props {
  readonly title?: string;
  /** When set, replaces the plain `title` text (e.g. translatable title). */
  readonly titleNode?: React.ReactNode;
  readonly tone: 'give' | 'request';
  readonly badgeLabel: string;
  readonly chip?: string | null;
  readonly closed?: boolean;
}

const useStyles = makeUseStyles(({ colors }) => ({
  wrap: { gap: spacing.xs },
  pills: { flexDirection: rowDirectionStart, flexWrap: 'wrap' as const, gap: spacing.xs },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.full },
  givePill: { backgroundColor: colors.primarySurface },
  requestPill: { backgroundColor: `${colors.secondary}18` },
  pillText: { ...typography.label, fontSize: typography.caption.fontSize, ...typography.bold },
  givePillText: { color: colors.giveTag },
  requestPillText: { color: colors.secondary },
  neutralPill: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  neutralPillText: { color: colors.textSecondary },
  title: {
    ...typography.h2,
    lineHeight: 28,
    letterSpacing: -0.2,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
  },
}));

export function PostDetailHeader({ title, titleNode, tone, badgeLabel, chip, closed }: Props) {
  const { t } = useTranslation();
  const s = useStyles();
  const isGive = tone === 'give';
  return (
    <View style={s.wrap} testID="post-detail-header">
      <View style={s.pills}>
        <View style={[s.pill, isGive ? s.givePill : s.requestPill]}>
          <Text style={[s.pillText, isGive ? s.givePillText : s.requestPillText]}>{badgeLabel}</Text>
        </View>
        {chip ? (
          <View style={[s.pill, s.neutralPill]}>
            <Text style={[s.pillText, s.neutralPillText]}>{chip}</Text>
          </View>
        ) : null}
        {closed ? (
          <View style={[s.pill, s.neutralPill]} testID="post-detail-closed">
            <Text style={[s.pillText, s.neutralPillText]}>{t('cards.closed')}</Text>
          </View>
        ) : null}
      </View>
      {titleNode ?? (title ? <Text style={s.title}>{cleanDisplayTitle(title)}</Text> : null)}
    </View>
  );
}
