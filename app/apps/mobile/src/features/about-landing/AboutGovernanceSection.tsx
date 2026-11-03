import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, typography, spacing, radius, Text } from '@kc/ui';
import { aboutRtlText } from './aboutWebRtlStyle';

/**
 * About — Governance section (v1.0 §10). Three-stage constitution:
 * today (founder) → amuta (iron bylaws + board) → far future (democratic voting).
 */
export function AboutGovernanceSection() {
  const { t } = useTranslation();
  const styles = useStyles();

  return (
    <View>
      <Text style={styles.h}>{t('aboutContent.governanceTitle')}</Text>
      <Text style={styles.lead}>{t('aboutContent.governanceLead')}</Text>

      <View style={styles.stageList}>
        <Stage
          phase={t('aboutContent.phaseLabelToday')}
          title={t('aboutContent.governanceTodayTitle')}
          body={t('aboutContent.governanceTodayBody')}
          tone="current"
        />
        <Stage
          phase={t('aboutContent.phaseLabelSoon')}
          title={t('aboutContent.governanceAmutaTitle')}
          body={t('aboutContent.governanceAmutaBody')}
          tone="soon"
        />
        <Stage
          phase={t('aboutContent.phaseLabelFuture')}
          title={t('aboutContent.governanceFutureTitle')}
          body={t('aboutContent.governanceFutureBody')}
          tone="future"
        />
      </View>
    </View>
  );
}

interface StageProps {
  readonly phase: string;
  readonly title: string;
  readonly body: string;
  readonly tone: 'current' | 'soon' | 'future';
}

function stageToneStyles(
  tone: StageProps['tone'],
  styles: ReturnType<typeof useStyles>,
): { readonly card: object; readonly phase: object } {
  switch (tone) {
    case 'current':
      return { card: styles.toneCurrent, phase: styles.stagePhaseCurrent };
    case 'soon':
      return { card: styles.toneSoon, phase: styles.stagePhaseSoon };
    case 'future':
      return { card: styles.toneFuture, phase: styles.stagePhaseFuture };
  }
}

function Stage({ phase, title, body, tone }: StageProps) {
  const styles = useStyles();
  const { card, phase: phaseStyle } = stageToneStyles(tone, styles);
  return (
    <View style={[styles.stage, card]}>
      <Text style={[styles.stagePhase, phaseStyle]}>{phase}</Text>
      <Text style={styles.stageTitle}>{title}</Text>
      <Text style={styles.stageBody}>{body}</Text>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors, isDark }) => ({
  h: { ...typography.h4, color: colors.textPrimary, ...aboutRtlText, marginBottom: spacing.xs },
  lead: {
    ...typography.body,
    ...typography.bold,
    color: colors.primary,
    ...aboutRtlText,
    marginBottom: spacing.md,
  },
  stageList: { gap: spacing.sm },
  stage: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.xs,
  },
  toneCurrent: {
    backgroundColor: colors.primarySurface,
    borderColor: isDark ? colors.primary : colors.primaryLight,
  },
  toneSoon: {
    backgroundColor: colors.secondaryLight,
    borderColor: isDark ? colors.secondary : colors.border,
  },
  toneFuture: {
    backgroundColor: isDark ? colors.surfaceRaised : colors.surface,
    borderColor: colors.border,
  },
  stagePhase: {
    ...typography.label,
    ...typography.extraBold,
    ...aboutRtlText,
  },
  stagePhaseCurrent: { color: colors.primary },
  stagePhaseSoon: { color: colors.secondary },
  stagePhaseFuture: { color: colors.textSecondary },
  stageTitle: {
    ...typography.body,
    ...typography.bold,
    color: colors.textPrimary,
    ...aboutRtlText,
  },
  stageBody: {
    ...typography.body,
    color: colors.textSecondary,
    ...aboutRtlText,
    lineHeight: 22,
  },
}));
