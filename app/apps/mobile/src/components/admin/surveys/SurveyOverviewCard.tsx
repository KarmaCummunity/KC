// app/apps/mobile/src/components/admin/surveys/SurveyOverviewCard.tsx
// FR-ADMIN-021 — selectable survey summary card (counts + last response).
import type { ReactElement } from 'react';
import { Pressable, View } from 'react-native';
import { MirroredIcon } from '../../ui/MirroredIcon';
import type { AdminSurveyOverviewItem } from '@kc/domain';
import { iconSize, makeUseStyles, radius, shadow, spacing, Text, typography, useTheme } from '@kc/ui';
import { textAlignStart, rowDirectionStart } from '../../../lib/rtlLayout';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

function fmt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('he-IL', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export interface SurveyOverviewCardProps {
  readonly item: AdminSurveyOverviewItem;
  readonly onPress: () => void;
}

export function SurveyOverviewCard({ item, onPress }: SurveyOverviewCardProps): ReactElement {
  const styles = useStyles();
  const { colors } = useTheme();
  const L = useLocaleBundle();
  const t = L.admin.surveys.overview;
  const last = fmt(item.lastResponseAt);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.top}>
        <Text style={styles.title} numberOfLines={2}>{item.titleHe}</Text>
        {!item.isActive ? (
          <View style={styles.inactiveBadge}>
            <Text style={styles.inactiveText}>{t.inactiveBadge}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.metrics}>
        <Metric value={String(item.respondentCount)} label={t.respondents(item.respondentCount)} />
        <Metric value={String(item.responseTotal)} label={t.responses(item.responseTotal)} />
        <Metric value={String(item.questionCount)} label={t.questions(item.questionCount)} />
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText} numberOfLines={1}>
          {last ? t.lastResponse(last) : t.noResponses}
        </Text>
        <MirroredIcon name="chevron-forward" size={iconSize.md} color={colors.textSecondary} />
      </View>
    </Pressable>
  );
}

function Metric({ value, label }: { value: string; label: string }): ReactElement {
  const styles = useStyles();
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.base,
    gap: spacing.md,
    ...shadow.card,
  },
  pressed: { opacity: 0.7 },
  top: { flexDirection: rowDirectionStart, alignItems: 'flex-start', gap: spacing.sm },
  title: { flex: 1, fontSize: typography.bodyLarge.fontSize, ...typography.extraBold, color: colors.textPrimary, textAlign: textAlignStart() },
  inactiveBadge: {
    backgroundColor: colors.skeleton,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  inactiveText: { fontSize: typography.caption.fontSize, ...typography.bold, color: colors.textSecondary },
  metrics: { flexDirection: rowDirectionStart, gap: spacing.sm },
  metric: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    gap: spacing.xs,
  },
  metricValue: { fontSize: typography.h3.fontSize, ...typography.extraBold, color: colors.textPrimary },
  metricLabel: { fontSize: typography.caption.fontSize, ...typography.semiBold, color: colors.textSecondary },
  footer: { flexDirection: rowDirectionStart, alignItems: 'center', justifyContent: 'space-between' },
  footerText: { flex: 1, fontSize: typography.bodySmall.fontSize, color: colors.textSecondary, textAlign: textAlignStart() },
}));
