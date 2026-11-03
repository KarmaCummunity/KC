// Settings → surveys hub — FR-SETTINGS-015.
// Lists active surveys with completion chips; bottom row links to free feedback.
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import type { SurveyCompletionStatus, SurveyListItem } from '@kc/domain';
import { useDetailStackScreenOptions } from '../../src/navigation/detailStackScreenOptions';
import { rtlTextAlignStart } from '../../src/lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../../src/lib/webRtlStyle';
import { NotifyModal } from '../../src/components/NotifyModal';
import { container } from '../../src/lib/container';
import {
  RESEARCH_SHARE_SLUG,
  RESEARCH_SHARE_SRC_SETTINGS,
} from '../../src/lib/shareResearchSurvey';
import { triggerResearchShare } from '../../src/lib/triggerResearchShare';
import { useFeedSessionStore } from '../../src/store/feedSessionStore';

type ChipColors = { bg: string; text: string };

function getChipColors(
  status: SurveyCompletionStatus,
  colors: { success: string; warning: string; border: string; textInverse: string; textPrimary: string; textSecondary: string },
): ChipColors {
  if (status === 'completed') return { bg: colors.success, text: colors.textInverse };
  if (status === 'in_progress') return { bg: colors.warning, text: colors.textPrimary };
  return { bg: colors.border, text: colors.textSecondary };
}

type SurveyRowProps = {
  readonly item: SurveyListItem;
  readonly onPress: () => void;
  readonly onShare?: () => void;
};

function resolveChipLabel(
  status: SurveyCompletionStatus,
  t: (key: string) => string,
): string {
  if (status === 'completed') return t('survey.statusCompleted');
  if (status === 'in_progress') return t('survey.statusInProgress');
  return t('survey.statusNotStarted');
}

function SurveyRow({ item, onPress, onShare }: SurveyRowProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useSurveysHubStyles();
  const chip = getChipColors(item.completionStatus, colors);
  const chipLabel = resolveChipLabel(item.completionStatus, t);

  return (
    <View style={styles.row}>
      <Pressable
        style={styles.rowMain}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={item.titleHe}
      >
        <View style={styles.rowContent}>
          <Text style={styles.rowTitle}>{item.titleHe}</Text>
          {item.descriptionHe ? (
            <Text style={styles.rowDesc} numberOfLines={2}>
              {item.descriptionHe}
            </Text>
          ) : null}
        </View>
        <View style={[styles.chip, { backgroundColor: chip.bg }]}>
          <Text style={[styles.chipText, { color: chip.text }]}>{chipLabel}</Text>
        </View>
      </Pressable>
      {onShare ? (
        <Pressable
          style={({ pressed }) => [styles.shareBtn, pressed && styles.shareBtnPressed]}
          onPress={onShare}
          accessibilityRole="button"
          accessibilityLabel={t('survey.shareResearch.cardShareA11y')}
          hitSlop={8}
        >
          <Ionicons name="share-social-outline" size={22} color={colors.primary} />
        </Pressable>
      ) : null}
      <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8}>
        <Ionicons name="chevron-back" size={18} color={colors.textDisabled} />
      </Pressable>
    </View>
  );
}

export default function SurveysHubScreen() {
  const detailStackScreenOptions = useDetailStackScreenOptions();
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useSurveysHubStyles();
  const { colors } = useTheme();
  const [errorOpen, setErrorOpen] = React.useState(false);

  const surveysQuery = useQuery({
    queryKey: ['active-surveys'] as const,
    queryFn: () => container.listActiveSurveys.execute(),
  });

  React.useEffect(() => {
    if (surveysQuery.isError) setErrorOpen(true);
  }, [surveysQuery.isError]);

  const surveys = surveysQuery.data ?? [];
  const showToast = useFeedSessionStore((s) => s.showEphemeralToast);

  function shareMarketResearch() {
    void triggerResearchShare(
      RESEARCH_SHARE_SRC_SETTINGS,
      {
        title: t('survey.shareResearch.shareTitle'),
        message: t('survey.shareResearch.shareMessage'),
        toastShared: t('survey.shareResearch.toastShared'),
        toastCopied: t('survey.shareResearch.toastCopied'),
        toastFailed: t('survey.shareResearch.toastFailed'),
      },
      showToast,
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen
        options={{
          ...detailStackScreenOptions,
          headerTitle: t('survey.hubTitle'),
        }}
      />

      {surveysQuery.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {surveys.length === 0 ? (
            <Text style={styles.empty}>{t('survey.emptyState')}</Text>
          ) : (
            <View style={styles.list}>
              {surveys.map((item) => (
                <SurveyRow
                  key={item.slug}
                  item={item}
                  onPress={() =>
                    router.push({
                      pathname: '/settings/survey/[slug]',
                      params: { slug: item.slug },
                    })
                  }
                  onShare={
                    item.slug === RESEARCH_SHARE_SLUG ? shareMarketResearch : undefined
                  }
                />
              ))}
            </View>
          )}

          <Pressable
            style={styles.feedbackRow}
            onPress={() => router.push('/settings/feedback')}
            accessibilityRole="button"
          >
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={20}
              color={colors.primary}
            />
            <Text style={styles.feedbackText}>{t('survey.freeFeedbackRow')}</Text>
            <Ionicons name="chevron-back" size={18} color={colors.textDisabled} />
          </Pressable>
        </ScrollView>
      )}

      <NotifyModal
        visible={errorOpen}
        title={t('survey.loadErrorTitle')}
        message={t('survey.loadErrorMessage')}
        onDismiss={() => setErrorOpen(false)}
      />
    </SafeAreaView>
  );
}

const useSurveysHubStyles = makeUseStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.background, ...webViewRtl },
  scrollContent: { padding: spacing.base, gap: spacing.sm },
  empty: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    ...webTextRtl,
  },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...webViewRtl,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    ...webViewRtl,
  },
  rowContent: { flex: 1 },
  shareBtn: {
    padding: spacing.xs,
    borderRadius: radius.sm,
  },
  shareBtnPressed: { opacity: 0.6 },
  rowTitle: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  rowDesc: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    marginTop: 2,
    ...webTextRtl,
  },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  chipText: {
    ...typography.caption,
    fontWeight: '600',
    ...webTextRtl,
  },
  feedbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.sm,
    ...webViewRtl,
  },
  feedbackText: {
    ...typography.body,
    color: colors.primary,
    flex: 1,
    fontWeight: '600',
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
}));
