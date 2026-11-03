// End-of-survey viral share invitation — FR-RESEARCH-004 placement 2 extension.
import React, { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { webTextRtl, webViewRtl } from '../../lib/webRtlStyle';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import {
  shareResearchSurvey,
  RESEARCH_SHARE_SRC_DURING_SURVEY,
  type ShareResearchOutcome,
} from '../../lib/shareResearchSurvey';
import { track } from '../../lib/analytics';

export function ResearchEndShareCard(): React.JSX.Element {
  const { t } = useTranslation();
  const styles = useStyles();
  const { colors } = useTheme();
  const [shareStatus, setShareStatus] = useState<ShareResearchOutcome['kind'] | null>(null);

  const handleShare = useCallback(async () => {
    const origin =
      globalThis.window?.location?.origin
      ?? (process.env.EXPO_PUBLIC_WEB_BASE_URL as string | undefined)
      ?? '';

    const outcome = await shareResearchSurvey({
      webBaseUrl: origin,
      src: RESEARCH_SHARE_SRC_DURING_SURVEY,
      title: t('research.share.shareTitle'),
      message: t('research.share.endSurveyMessage'),
    });

    track('research_share_initiated', {
      slug: 'alt-platforms-research',
      src: RESEARCH_SHARE_SRC_DURING_SURVEY,
      outcome: outcome.kind,
    });

    if (outcome.kind !== 'dismissed') {
      setShareStatus(outcome.kind);
      setTimeout(() => setShareStatus(null), 2200);
    }
  }, [t]);

  return (
    <View style={[styles.card, webViewRtl]}>
      <View style={styles.iconRow}>
        <Ionicons name="people-outline" size={22} color={colors.primary} />
        <Text style={styles.eyebrow}>{t('research.share.endSurveyEyebrow')}</Text>
      </View>
      <Text style={styles.title}>{t('research.share.endSurveyTitle')}</Text>
      <Text style={styles.body}>{t('research.share.endSurveyBody')}</Text>
      <Pressable
        style={({ pressed }) => [styles.shareBtn, pressed && styles.shareBtnPressed]}
        onPress={handleShare}
        accessibilityRole="button"
        accessibilityLabel={t('research.share.endSurveyTitle')}
      >
        <Ionicons name="share-social-outline" size={18} color={colors.textInverse} />
        <Text style={styles.shareBtnText}>{t('research.share.endSurveyCta')}</Text>
      </Pressable>
      {shareStatus ? (
        <Text
          style={[
            styles.statusLine,
            shareStatus === 'failed' && styles.statusLineError,
          ]}
        >
          {shareStatus === 'shared' && t('research.share.statusShared')}
          {shareStatus === 'copied' && t('research.share.statusCopied')}
          {shareStatus === 'failed' && t('research.share.statusFailed')}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  card: {
    gap: spacing.sm,
    padding: spacing.base,
    borderRadius: 14,
    backgroundColor: colors.primarySurface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  eyebrow: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    ...webTextRtl,
  },
  title: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    lineHeight: 22,
    ...webTextRtl,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  shareBtnPressed: { opacity: 0.88 },
  shareBtnText: {
    ...typography.button,
    color: colors.textInverse,
    fontWeight: '700',
    ...webTextRtl,
  },
  statusLine: {
    ...typography.caption,
    color: colors.primary,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  statusLineError: { color: colors.error },
}));
