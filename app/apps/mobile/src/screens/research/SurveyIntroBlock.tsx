// Intro block for the public research survey form — FR-RESEARCH-001 (intro copy)
// and FR-RESEARCH-004 placement 2 (small share button + inline status line).
// Extracted from [slug].web.tsx to keep that route file under the size cap.
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

export function SurveyIntroBlock(): React.JSX.Element {
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
      message: t('research.share.shareMessage'),
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
    <View style={[styles.introBlock, webViewRtl]}>
      <View style={styles.introTopRow}>
        <Text style={styles.introHeading}>{t('research.introHeading')}</Text>
        <Pressable
          style={({ pressed }) => [
            styles.shareBtnSmall,
            pressed && styles.shareBtnSmallPressed,
          ]}
          onPress={handleShare}
          accessibilityRole="button"
          accessibilityLabel={t('research.share.duringSurveyAria')}
        >
          <Ionicons name="share-social-outline" size={14} color={colors.primary} />
          <Text style={styles.shareBtnSmallText}>
            {t('research.share.duringSurveyLabel')}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.introLine}>{t('research.introLine1')}</Text>
      <Text style={styles.introLine}>{t('research.introLine2')}</Text>
      <Text style={styles.introLine}>{t('research.introLine3')}</Text>

      {shareStatus && (
        <Text
          style={[
            styles.shareStatusLine,
            shareStatus === 'failed' && styles.shareStatusLineError,
          ]}
        >
          {shareStatus === 'shared' && t('research.share.statusShared')}
          {shareStatus === 'copied' && t('research.share.statusCopied')}
          {shareStatus === 'failed' && t('research.share.statusFailed')}
        </Text>
      )}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  introBlock: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: 16,
    backgroundColor: colors.primarySurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  introTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  introHeading: {
    ...typography.h2,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  introLine: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 23,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  shareBtnSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.primarySurface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  shareBtnSmallPressed: { opacity: 0.6 },
  shareBtnSmallText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
    ...webTextRtl,
  },
  shareStatusLine: {
    ...typography.caption,
    color: colors.primary,
    textAlign: rtlTextAlignStart,
    marginTop: spacing.xs,
    ...webTextRtl,
  },
  shareStatusLineError: {
    color: colors.error,
  },
}));
