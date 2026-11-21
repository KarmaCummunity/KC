// Web-only thank-you page — shown after the finish popup is dismissed (FR-RESEARCH-001 AC5).
import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MirroredIcon } from '../../src/components/ui/MirroredIcon';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, spacing, typography, radius, iconSize, useTheme, Text } from '@kc/ui';
import { webTextRtl, webViewRtl } from '../../src/lib/webRtlStyle';
import { rtlTextAlignStart } from '../../src/lib/rtlLayout';
import { RESEARCH_SHARE_SRC_THANKS } from '../../src/lib/shareResearchSurvey';
import { triggerResearchShare } from '../../src/lib/triggerResearchShare';
import { useAuthStore } from '../../src/store/authStore';

const KARMA_SITE_URL = 'https://karma.community';
const AUTO_REDIRECT_MS = 5000;

export default function ResearchThanksScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [shareFeedback, setShareFeedback] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [showVisitLink, setShowVisitLink] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowVisitLink(true), AUTO_REDIRECT_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!shareFeedback) return;
    const timer = setTimeout(() => setShareFeedback(null), 2200);
    return () => clearTimeout(timer);
  }, [shareFeedback]);

  const handleShare = useCallback(
    async () => {
      setShareFeedback(null);
      await triggerResearchShare(RESEARCH_SHARE_SRC_THANKS, {
        title: t('research.share.shareTitle'),
        message: t('research.share.shareMessage'),
        toastShared: t('research.share.statusShared'),
        toastCopied: t('research.share.statusCopied'),
        toastFailed: t('research.share.statusFailed'),
      }, (message, tone) => setShareFeedback({ message, tone }));
    },
    [t],
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text style={styles.heading}>{t('research.thanksHeading')}</Text>
        <Text style={styles.line}>{t('research.thanksLine1')}</Text>

        <View style={styles.shareBlock}>
          <Text style={styles.shareBlockTitle}>{t('research.share.thanksBlockTitle')}</Text>
          <Text style={styles.shareBlockBody}>{t('research.share.thanksBlockBody')}</Text>
          <Pressable style={styles.shareBtn} onPress={handleShare} accessibilityRole="button">
            <Ionicons name="share-social-outline" size={iconSize.lg} color={colors.textInverse} />
            <Text style={styles.shareBtnText}>{t('research.share.thanksTitle')}</Text>
          </Pressable>
          {shareFeedback ? (
            <Text accessibilityRole="text" accessibilityLiveRegion="polite" testID="research-share-status" style={[styles.shareStatus, shareFeedback.tone === 'error' && { color: colors.error }]}>
              {shareFeedback.message}
            </Text>
          ) : null}
        </View>

        {!isAuthenticated ? (
          <View style={styles.signUpBlock}>
            <Text style={styles.signUpLead}>{t('research.thanksSignUpLead')}</Text>
            <Pressable
              style={styles.signUpBtn}
              onPress={() => router.push('/(auth)')}
              accessibilityRole="button"
            >
              <Text style={styles.signUpBtnText}>{t('research.guestInvite.signUpCta')}</Text>
              <MirroredIcon name="arrow-forward" size={iconSize.md} color={colors.primary} />
            </Pressable>
          </View>
        ) : null}

        {showVisitLink ? (
          <Pressable style={styles.visitBtn} onPress={() => Linking.openURL(KARMA_SITE_URL)}>
            <Text style={styles.visitBtnText}>{t('research.thanksVisitCta')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    ...webViewRtl,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...webViewRtl,
  },
  heading: {
    ...typography.h2,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  line: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    lineHeight: 24,
    ...webTextRtl,
  },
  shareStatus: { ...typography.caption, textAlign: rtlTextAlignStart, color: colors.textSecondary },
  shareBlock: {
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.base,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySurface,
    borderWidth: 1,
    borderColor: colors.primary,
    ...webViewRtl,
  },
  shareBlockTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  shareBlockBody: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    lineHeight: 20,
    ...webTextRtl,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  shareBtnText: {
    ...typography.button,
    color: colors.textInverse,
    ...typography.bold,
    ...webTextRtl,
  },
  signUpBlock: {
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  signUpLead: {
    ...typography.body,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    lineHeight: 22,
    ...webTextRtl,
  },
  signUpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primarySurface,
  },
  signUpBtnText: {
    ...typography.button,
    color: colors.primary,
    ...typography.bold,
    ...webTextRtl,
  },
  visitBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  visitBtnText: {
    ...typography.button,
    color: colors.textInverse,
    ...webTextRtl,
  },
}));
