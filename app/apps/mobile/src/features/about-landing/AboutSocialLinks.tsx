import React, { useCallback, useMemo } from 'react';
import { View, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, makeUseStyles, typography, spacing, radius, useTheme, Text } from '@kc/ui';
import {
  ABOUT_FACEBOOK_PROFILE_URL,
  ABOUT_INSTAGRAM_PROFILE_URL,
  ABOUT_TIKTOK_PROFILE_URL,
} from './aboutExternalLinks';
import { aboutOpenExternalUrl } from './aboutOpenExternalUrl';
import { aboutRtlText, aboutRtlRow } from './aboutWebRtlStyle';
import { MirroredIcon } from '../../components/ui/MirroredIcon';

type Row = {
  readonly key: string;
  readonly label: string;
  readonly url: string;
  readonly icon: React.ComponentProps<typeof Ionicons>['name'];
};

export function AboutSocialLinks() {
  const { t } = useTranslation();
  const styles = useAboutSocialLinksStyles();
  const { colors } = useTheme();

  const open = useCallback(
    async (url: string) => {
      await aboutOpenExternalUrl(url, t('aboutContent.contactLinkError'));
    },
    [t],
  );

  const rows: Row[] = useMemo(
    () => [
      {
        key: 'ig',
        label: t('aboutContent.socialInstagramLabel'),
        url: ABOUT_INSTAGRAM_PROFILE_URL,
        icon: 'logo-instagram',
      },
      {
        key: 'fb',
        label: t('aboutContent.socialFacebookLabel'),
        url: ABOUT_FACEBOOK_PROFILE_URL,
        icon: 'logo-facebook',
      },
      {
        key: 'tt',
        label: t('aboutContent.socialTiktokLabel'),
        url: ABOUT_TIKTOK_PROFILE_URL,
        icon: 'logo-tiktok',
      },
    ],
    [t],
  );

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{t('aboutContent.socialTitle')}</Text>
      <Text style={styles.caption}>{t('aboutContent.socialCaption')}</Text>
      {rows.map((row) => (
        <Pressable
          key={row.key}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          onPress={() => void open(row.url)}
          accessibilityRole="link"
          accessibilityLabel={row.label}
        >
          <MirroredIcon name="chevron-forward" size={iconSize.md} color={colors.textDisabled} />
          <Text style={styles.label}>{row.label}</Text>
          <Ionicons name={row.icon} size={iconSize.xl} color={colors.primary} />
        </Pressable>
      ))}
    </View>
  );
}

const useAboutSocialLinksStyles = makeUseStyles(({ colors }) => ({
  wrap: { gap: spacing.sm },
  title: { ...typography.h4, color: colors.textPrimary, ...aboutRtlText, marginBottom: spacing.xs },
  caption: {
    ...typography.body,
    color: colors.textSecondary,
    ...aboutRtlText,
    lineHeight: 24,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: aboutRtlRow,
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  rowPressed: { opacity: 0.92, backgroundColor: colors.primarySurface },
  label: { flex: 1, ...typography.body, color: colors.textPrimary, ...aboutRtlText, ...typography.semiBold },
}));
