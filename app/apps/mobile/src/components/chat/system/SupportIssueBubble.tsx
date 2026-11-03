// FR-MOD-002 AC3 / FR-CHAT-007 AC3 — renders the system message injected when
// a user submits a support issue from Settings → Report an Issue.
import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, radius, spacing, typography, iconSize, useTheme, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../../lib/rtlTextAlignStart';
import { useTranslation } from 'react-i18next';
import type { SystemMessageBubbleProps } from './SystemMessageBubble';

export function SupportIssueBubble({ payload }: SystemMessageBubbleProps) {
  const styles = useSupportIssueBubbleStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const issueId = payload?.issue_id as string | undefined;
  const category = payload?.category as string | undefined;
  const description = payload?.description as string | undefined;
  const categoryLabel = category
    ? t(`settings.reportIssueScreen.categories.${category}`, { defaultValue: category })
    : undefined;
  const shortId = issueId ? issueId.slice(-8) : undefined;

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.iconBadge}>
            <Ionicons name="headset-outline" size={iconSize.md} color={colors.info} />
          </View>
          <Text style={styles.title}>{t('moderation.supportIssueBubble.title')}</Text>
        </View>

        {categoryLabel ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>{t('moderation.supportIssueBubble.categoryLabel')}</Text>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>{categoryLabel}</Text>
            </View>
          </View>
        ) : null}

        {description ? (
          <View style={styles.descriptionBox}>
            <Text style={styles.description}>{description}</Text>
          </View>
        ) : null}

        {shortId ? (
          <Text style={styles.ref}>{`${t('moderation.supportIssueBubble.issueRef')} …${shortId}`}</Text>
        ) : null}
      </View>
    </View>
  );
}

const useSupportIssueBubbleStyles = makeUseStyles(({ colors, isDark }) => ({
  wrap: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    gap: spacing.sm,
    padding: spacing.base,
    borderRadius: radius.lg,
    backgroundColor: colors.infoLight,
    borderWidth: 1,
    borderColor: isDark ? colors.border : colors.infoLight,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  title: {
    ...typography.body,
    flex: 1,
    color: colors.textPrimary,
    ...typography.bold,
    textAlign: rtlTextAlignStart,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  metaLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
  },
  categoryBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryText: {
    ...typography.caption,
    color: colors.info,
    ...typography.semiBold,
  },
  descriptionBox: {
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: isDark ? 1 : 0,
    borderColor: colors.border,
  },
  description: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    lineHeight: 20,
  },
  ref: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    fontVariant: ['tabular-nums'],
  },
}));
