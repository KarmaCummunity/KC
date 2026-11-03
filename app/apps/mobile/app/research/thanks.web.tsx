// Web-only thank-you page — shown after the finish popup is dismissed (FR-RESEARCH-001 AC5).
import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { webTextRtl, webViewRtl } from '../../src/lib/webRtlStyle';
import { rtlTextAlignStart } from '../../src/lib/rtlTextAlignStart';
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
  const [showVisitLink, setShowVisitLink] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowVisitLink(true), AUTO_REDIRECT_MS);
    return () => clearTimeout(timer);
  }, []);

  const handleShare = useCallback(
    () =>
      triggerResearchShare(RESEARCH_SHARE_SRC_THANKS, {
        title: t('research.share.shareTitle'),
        message: t('research.share.shareMessage'),
        toastShared: t('research.share.statusShared'),
        toastCopied: t('research.share.statusCopied'),
        toastFailed: t('research.share.statusFailed'),
      }),
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
            <Ionicons name="share-social-outline" size={20} color={colors.textInverse} />
            <Text style={styles.shareBtnText}>{t('research.share.thanksTitle')}</Text>
          </Pressable>
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
              <Ionicons name="arrow-back" size={18} color={colors.primary} />
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
    borderRadius: 16,
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
  shareBlock: {
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.base,
    borderRadius: 14,
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
    borderRadius: 12,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  shareBtnText: {
    ...typography.button,
    color: colors.textInverse,
    fontWeight: '700',
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
    borderRadius: 12,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primarySurface,
  },
  signUpBtnText: {
    ...typography.button,
    color: colors.primary,
    fontWeight: '700',
    ...webTextRtl,
  },
  visitBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  visitBtnText: {
    ...typography.button,
    color: colors.textInverse,
    ...webTextRtl,
  },
}));
