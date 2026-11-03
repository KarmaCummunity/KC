import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, typography, spacing, radius, Text } from '@kc/ui';
import { aboutRtlText } from './aboutWebRtlStyle';

/**
 * About — Money section (v1.0 §11). Three-layer model + permanent red lines.
 * Headline: "Money doesn't flow between people. Period."
 */
export function AboutMoneySection() {
  const { t } = useTranslation();
  const styles = useStyles();

  return (
    <View>
      <Text style={styles.h}>{t('aboutContent.moneyTitle')}</Text>
      <Text style={styles.headline}>{t('aboutContent.moneyLead')}</Text>

      <View style={styles.layerList}>
        <Layer
          phase={t('aboutContent.phaseLabelToday')}
          title={t('aboutContent.moneyTodayTitle')}
          body={t('aboutContent.moneyTodayBody')}
          tone="current"
        />
        <Layer
          phase={t('aboutContent.phaseLabelSoon')}
          title={t('aboutContent.moneySoonTitle')}
          body={t('aboutContent.moneySoonBody')}
          tone="soon"
        />
        <Layer
          phase={t('aboutContent.phaseLabelFuture')}
          title={t('aboutContent.moneyFutureTitle')}
          body={t('aboutContent.moneyFutureBody')}
          tone="future"
        />
      </View>

      <View style={styles.redLines}>
        <Text style={styles.redLinesTitle}>{t('aboutContent.moneyRedLinesTitle')}</Text>
        <Text style={styles.redLinesBody}>{t('aboutContent.moneyRedLinesBody')}</Text>
      </View>
    </View>
  );
}

interface LayerProps {
  readonly phase: string;
  readonly title: string;
  readonly body: string;
  readonly tone: 'current' | 'soon' | 'future';
}

function Layer({ phase, title, body, tone }: LayerProps) {
  const styles = useStyles();
  const toneStyle =
    tone === 'current' ? styles.toneCurrent : tone === 'soon' ? styles.toneSoon : styles.toneFuture;
  return (
    <View style={[styles.layer, toneStyle]}>
      <Text style={styles.layerPhase}>{phase}</Text>
      <Text style={styles.layerTitle}>{title}</Text>
      <Text style={styles.layerBody}>{body}</Text>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  h: { ...typography.h4, color: colors.textPrimary, ...aboutRtlText, marginBottom: spacing.xs },
  headline: {
    ...typography.h4,
    color: colors.error,
    ...aboutRtlText,
    ...typography.extraBold,
    marginBottom: spacing.md,
  },
  layerList: { gap: spacing.sm },
  layer: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.xs,
  },
  toneCurrent: { backgroundColor: colors.successLight, borderColor: colors.success },
  toneSoon: { backgroundColor: colors.infoLight, borderColor: colors.info },
  toneFuture: { backgroundColor: colors.warningLight, borderColor: colors.warning },
  layerPhase: {
    ...typography.label,
    ...typography.extraBold,
    color: colors.textPrimary,
    ...aboutRtlText,
  },
  layerTitle: {
    ...typography.body,
    ...typography.bold,
    color: colors.textPrimary,
    ...aboutRtlText,
  },
  layerBody: {
    ...typography.body,
    color: colors.textSecondary,
    ...aboutRtlText,
    lineHeight: 22,
  },
  redLines: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.errorLight,
    borderWidth: 2,
    borderColor: colors.error,
    gap: spacing.xs,
  },
  redLinesTitle: {
    ...typography.label,
    ...typography.extraBold,
    color: colors.error,
    ...aboutRtlText,
  },
  redLinesBody: {
    ...typography.body,
    color: colors.textPrimary,
    ...aboutRtlText,
    lineHeight: 22,
  },
}));
