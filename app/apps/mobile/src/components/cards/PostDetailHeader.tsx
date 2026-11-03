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
  readonly title: string;
  readonly tone: 'give' | 'request';
  readonly badgeLabel: string;
  readonly chip?: string | null;
  readonly closed?: boolean;
}

const useStyles = makeUseStyles(({ colors }) => ({
  wrap: { gap: spacing.xs },
  pills: { flexDirection: rowDirectionStart, flexWrap: 'wrap' as const, gap: spacing.xs },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full },
  givePill: { backgroundColor: colors.primarySurface },
  requestPill: { backgroundColor: `${colors.secondary}18` },
  pillText: { ...typography.label, fontSize: 11, fontWeight: '700' as const },
  givePillText: { color: colors.giveTag },
  requestPillText: { color: colors.secondary },
  chip: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  chipText: { color: colors.textSecondary },
  title: { ...typography.h2, color: colors.textPrimary, textAlign: rtlTextAlignStart },
}));

export function PostDetailHeader({ title, tone, badgeLabel, chip, closed }: Props) {
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
          <View style={[s.pill, s.chip]}>
            <Text style={[s.pillText, s.chipText]}>{chip}</Text>
          </View>
        ) : null}
        {closed ? (
          <View style={[s.pill, s.chip]} testID="post-detail-closed">
            <Text style={[s.pillText, s.chipText]}>{t('cards.closed')}</Text>
          </View>
        ) : null}
      </View>
      <Text style={s.title}>{cleanDisplayTitle(title)}</Text>
    </View>
  );
}
