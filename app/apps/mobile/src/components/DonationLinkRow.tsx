// FR-DONATE-007/009 — single row in the community NGO link list.
import React, { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { DonationLink } from '@kc/domain';
import { makeUseStyles, radius, shadow, spacing, typography, iconSize, useTheme, Text } from '@kc/ui';
import { openExternalUrl } from '../utils/openExternalUrl';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';
import { rowDirectionStart } from '../lib/rtlLayout';

interface Props {
  link: DonationLink;
  canRemove: boolean;
  onMenuPress: (link: DonationLink) => void;
}

function getHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const useStyles = makeUseStyles(({ colors, isDark }) => ({
  row: {
    minHeight: 80,
    flexDirection: rowDirectionStart,
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
    ...shadow.card,
    shadowOpacity: isDark ? 0 : shadow.card.shadowOpacity,
    elevation: isDark ? 0 : shadow.card.elevation,
  },
  rowMain: {
    flex: 1,
    flexDirection: rowDirectionStart,
    alignItems: 'center' as const,
    gap: spacing.md,
    minWidth: 0,
  },
  rowPressed: {
    backgroundColor: colors.background,
    transform: [{ scale: 0.99 }],
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    overflow: 'hidden' as const,
  },
  favicon: { width: 28, height: 28 },
  body: { flex: 1, gap: spacing.xs },
  title: { ...typography.h3, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  description: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  host: { ...typography.caption, color: colors.textDisabled, textAlign: rtlTextAlignStart },
  menuBtn: {
    width: 32,
    height: 32,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderRadius: radius.sm,
  },
}));

export function DonationLinkRow({ link, canRemove, onMenuPress }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const host = getHost(link.url);
  const [iconError, setIconError] = useState(false);
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${host}&sz=64`;

  const open = () => { openExternalUrl(link.url); };

  return (
    <View style={styles.row}>
      <Pressable
        onPress={open}
        accessibilityRole="link"
        accessibilityLabel={`${link.displayName} — ${host}`}
        style={({ pressed }) => [styles.rowMain, pressed && styles.rowPressed]}
      >
        <View style={styles.iconWrap}>
          {iconError ? (
            <Ionicons name="link-outline" size={iconSize.xl} color={colors.primary} />
          ) : (
            <Image
              source={{ uri: faviconUrl }}
              style={styles.favicon}
              onError={() => setIconError(true)}
            />
          )}
        </View>

        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>{link.displayName}</Text>
          {link.description ? (
            <Text style={styles.description} numberOfLines={2}>{link.description}</Text>
          ) : null}
          <Text style={styles.host} numberOfLines={1}>{host}</Text>
        </View>
      </Pressable>

      <Pressable
        onPress={() => onMenuPress(link)}
        accessibilityRole="button"
        accessibilityLabel={canRemove ? t('optionsMenu.more') : t('optionsMenu.default')}
        hitSlop={8}
        style={styles.menuBtn}
      >
        <Ionicons name="ellipsis-horizontal" size={iconSize.lg} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}
