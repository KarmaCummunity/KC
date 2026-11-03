// Vertical numbered timeline for the About roadmap section — summary + per-phase expand.
import React, { useCallback, useState } from 'react';
import { View, Pressable, LayoutAnimation, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, typography, spacing, radius, iconSize, useTheme, Text } from '@kc/ui';
import { aboutRtlText, aboutRtlRow } from './aboutWebRtlStyle';

type PhaseSeverity = 'current' | 'soon' | 'future' | 'long-term';

interface Phase {
  readonly label: string;
  readonly severity: PhaseSeverity;
  readonly status: string;
  readonly title: string;
  readonly summary?: string;
  readonly body?: string;
  readonly details?: string;
}

function phaseCardStyle(
  severity: PhaseSeverity,
  styles: ReturnType<typeof useAboutRoadmapTimelineStyles>,
): object {
  switch (severity) {
    case 'current':
      return styles.cardCurrent;
    case 'soon':
      return styles.cardSoon;
    case 'future':
      return styles.cardFuture;
    case 'long-term':
      return styles.cardLongTerm;
  }
}

export function AboutRoadmapTimeline() {
  const { t } = useTranslation();
  const styles = useAboutRoadmapTimelineStyles();
  const { colors } = useTheme();
  const phases: Phase[] = t('aboutContent.roadmapPhases', { returnObjects: true }) as Phase[];
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const severityColor: Record<PhaseSeverity, string> = {
    current: colors.primary,
    soon: colors.secondary,
    future: colors.textSecondary,
    'long-term': colors.textDisabled,
  };

  const toggle = useCallback((i: number) => {
    if (Platform.OS !== 'web') LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((prev) => ({ ...prev, [i]: !prev[i] }));
  }, []);

  return (
    <View style={styles.wrap}>
      {phases.map((p, i) => {
        const isLast = i === phases.length - 1;
        const accent = severityColor[p.severity] ?? colors.textSecondary;
        const summary = p.summary ?? p.body ?? '';
        const details = p.details ?? '';
        const expanded = !!open[i];
        return (
          <View key={p.label} style={styles.row}>
            <View style={styles.timeline}>
              <View style={[styles.dotRing, { borderColor: accent }]}>
                <View style={[styles.dot, { backgroundColor: accent }]}>
                  <Text style={styles.dotNum}>{i + 1}</Text>
                </View>
              </View>
              {isLast ? null : <View style={[styles.line, { backgroundColor: accent, opacity: 0.25 }]} />}
            </View>
            <View style={[styles.card, phaseCardStyle(p.severity, styles)]}>
              <View style={styles.headerRow}>
                <Text style={styles.label}>{p.label}</Text>
                <View style={[styles.statusBadge, { backgroundColor: accent }]}>
                  <Text style={styles.statusText}>{p.status}</Text>
                </View>
              </View>
              <Text style={styles.title}>{p.title}</Text>
              <Text style={styles.summary}>{summary}</Text>
              {details ? (
                <>
                  <Pressable
                    style={styles.expandBtn}
                    onPress={() => toggle(i)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                  >
                    <Text style={[styles.expandLabel, { color: accent }]}>
                      {expanded ? t('aboutContent.roadmapExpandLess') : t('aboutContent.roadmapExpandMore')}
                    </Text>
                    <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={iconSize.sm} color={accent} />
                  </Pressable>
                  {expanded ? (
                    <View style={[styles.detailsBox, { borderStartColor: accent }]}>
                      <Text style={styles.details}>{details}</Text>
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const DOT = 28;
const useAboutRoadmapTimelineStyles = makeUseStyles(({ colors, isDark }) => ({
  wrap: { gap: spacing.xs },
  row: { flexDirection: aboutRtlRow, gap: spacing.md, alignItems: 'stretch' },
  timeline: { alignItems: 'center', width: DOT + 8, paddingTop: spacing.sm },
  dotRing: {
    width: DOT + 8,
    height: DOT + 8,
    borderRadius: radius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: isDark ? colors.surface : colors.background,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotNum: { ...typography.label, color: colors.textInverse, ...typography.extraBold },
  line: { flex: 1, width: 2, marginTop: spacing.xs, minHeight: 24 },
  card: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  cardCurrent: {
    backgroundColor: colors.primarySurface,
    borderColor: isDark ? colors.primary : colors.primaryLight,
  },
  cardSoon: {
    backgroundColor: colors.secondaryLight,
    borderColor: isDark ? colors.secondary : colors.border,
  },
  cardFuture: {
    backgroundColor: isDark ? colors.surfaceRaised : colors.surface,
    borderColor: colors.border,
  },
  cardLongTerm: {
    backgroundColor: isDark ? colors.surface : colors.background,
    borderColor: colors.border,
    borderStyle: 'dashed' as const,
  },
  headerRow: {
    flexDirection: aboutRtlRow,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  statusText: { ...typography.caption, color: colors.textInverse, ...typography.bold },
  label: { ...typography.label, color: colors.textDisabled, ...typography.extraBold, ...aboutRtlText },
  title: { ...typography.body, ...typography.extraBold, color: colors.textPrimary, ...aboutRtlText },
  summary: { ...typography.body, color: colors.textSecondary, ...aboutRtlText, lineHeight: 23 },
  expandBtn: {
    flexDirection: aboutRtlRow,
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: isDark ? colors.surfaceRaised : colors.background,
  },
  expandLabel: { ...typography.caption, ...typography.bold },
  detailsBox: {
    marginTop: spacing.xs,
    paddingStart: spacing.md,
    borderStartWidth: 3,
  },
  details: {
    ...typography.body,
    color: colors.textSecondary,
    ...aboutRtlText,
    lineHeight: 23,
  },
}));
