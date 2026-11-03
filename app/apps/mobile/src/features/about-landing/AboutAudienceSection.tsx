// Audience block — visually emphasized on About (FR-SETTINGS-001 About narrative).
import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, typography, spacing, radius, shadow, iconSize, useTheme, Text } from '@kc/ui';
import { aboutRtlText, aboutRtlRow } from './aboutWebRtlStyle';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface AudienceGroup {
  readonly icon: IoniconName;
  readonly label: string;
}

export function AboutAudienceSection() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useAboutAudienceSectionStyles();
  const groups = t('aboutContent.audienceGroups', {
    returnObjects: true,
  }) as AudienceGroup[];

  return (
    <View style={styles.card} accessibilityRole="summary">
      <View style={styles.headerRow}>
        <View style={styles.iconBadge}>
          <Ionicons name="people" size={iconSize['2xl']} color={colors.textInverse} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {t('aboutContent.audienceTitle')}
        </Text>
      </View>
      <Text style={styles.lead}>{t('aboutContent.audienceLead')}</Text>
      <View style={styles.groups}>
        {groups.map((group) => (
          <View key={group.label} style={styles.groupRow}>
            <View style={styles.groupIconWrap}>
            <Ionicons name={group.icon} size={iconSize.md} color={colors.primary} />
            </View>
            <Text style={styles.groupLabel}>{group.label}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.footnote}>{t('aboutContent.audienceFootnote')}</Text>
    </View>
  );
}

const useAboutAudienceSectionStyles = makeUseStyles(({ colors, isDark }) => ({
  card: {
    backgroundColor: colors.primarySurface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1.5,
    borderColor: isDark ? colors.primary : colors.primaryLight,
    gap: spacing.md,
    ...shadow.glow,
    shadowColor: colors.primary,
  },
  headerRow: {
    flexDirection: aboutRtlRow,
    alignItems: 'center',
    gap: spacing.md,
  },
  iconBadge: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.glow,
    shadowColor: colors.primary,
  },
  title: {
    ...typography.h3,
    color: colors.textPrimary,
    flex: 1,
    ...aboutRtlText,
  },
  lead: {
    ...typography.body,
    ...typography.semiBold,
    color: colors.textPrimary,
    ...aboutRtlText,
    lineHeight: 24,
  },
  groups: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: isDark ? colors.surface : colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: isDark ? colors.border : colors.primaryLight,
  },
  groupRow: {
    flexDirection: aboutRtlRow,
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  groupIconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.primarySurface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.primaryLight,
  },
  groupLabel: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
    ...aboutRtlText,
    lineHeight: 22,
  },
  footnote: {
    ...typography.caption,
    color: colors.textSecondary,
    ...aboutRtlText,
    lineHeight: 20,
    fontStyle: 'italic' as const,
  },
}));
