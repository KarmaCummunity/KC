// Sub-components for the Appearance settings screen (FR-SETTINGS-014).
// Lives under src/ (not app/) so expo-router does not register it as a route.
import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import {
  iconSize,
  makeUseStyles,
  radius,
  spacing,
  typography,
  useTheme,
  type ColorPalette,
  type ThemeMode,
  Text,
} from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../../lib/webRtlStyle';

export interface ModeOption {
  readonly mode: ThemeMode;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly labelKey: string;
  readonly hintKey: string;
}

interface ModeRowProps {
  readonly selected: boolean;
  readonly option: ModeOption;
  readonly onSelect: () => void;
}

export function ModeRow({ selected, option, onSelect }: ModeRowProps) {
  const { t } = useTranslation();
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.modeRow,
        selected && styles.modeRowSelected,
        pressed && styles.modeRowPressed,
      ]}
    >
      <View
        style={[
          styles.iconBubble,
          selected && styles.iconBubbleSelected,
        ]}
      >
        <Ionicons
          name={option.icon}
          size={iconSize.lg}
          color={selected ? colors.textInverse : colors.textSecondary}
        />
      </View>
      <View style={styles.modeText}>
        <Text style={styles.modeLabel}>{t(option.labelKey)}</Text>
        <Text style={styles.modeHint}>{t(option.hintKey)}</Text>
      </View>
      <View
        style={[
          styles.radio,
          selected && styles.radioSelected,
        ]}
      >
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
    </Pressable>
  );
}

interface PalettePreviewProps {
  readonly palette: ColorPalette;
  readonly labelKey: string;
}

export function PalettePreview({ palette, labelKey }: PalettePreviewProps) {
  const { t } = useTranslation();
  const styles = useStyles();

  return (
    <View
      style={[
        styles.previewCard,
        {
          backgroundColor: palette.background,
          borderColor: palette.border,
        },
      ]}
    >
      <Text
        style={[
          styles.previewLabel,
          { color: palette.textSecondary },
        ]}
      >
        {t(labelKey)}
      </Text>
      <View
        style={[
          styles.previewSurface,
          {
            backgroundColor: palette.surface,
            borderColor: palette.border,
          },
        ]}
      >
        <Text
          style={[styles.previewHeading, { color: palette.textPrimary }]}
        >
          {t('settings.appearanceScreen.previewHeading')}
        </Text>
        <Text
          style={[styles.previewBody, { color: palette.textSecondary }]}
        >
          {t('settings.appearanceScreen.previewBody')}
        </Text>
        <View style={styles.previewChipsRow}>
          <View
            style={[
              styles.previewChip,
              { backgroundColor: palette.giveTagBg },
            ]}
          >
            <Text
              style={[
                styles.previewChipText,
                { color: palette.giveTag },
              ]}
            >
              {t('settings.appearanceScreen.previewPrimary')}
            </Text>
          </View>
          <View
            style={[
              styles.previewChip,
              { backgroundColor: palette.requestTagBg },
            ]}
          >
            <Text
              style={[
                styles.previewChipText,
                { color: palette.requestTag },
              ]}
            >
              {t('settings.appearanceScreen.previewSecondary')}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  modeRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    ...webViewRtl,
  },
  modeRowSelected: {
    backgroundColor: colors.primarySurface,
  },
  modeRowPressed: { opacity: 0.7 },
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconBubbleSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  modeText: { flex: 1 },
  modeLabel: {
    ...typography.body,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    ...typography.semiBold,
    ...webTextRtl,
  },
  modeHint: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    marginTop: spacing.xs,
    ...webTextRtl,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  radioSelected: { borderColor: colors.primary },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: radius.xs,
    backgroundColor: colors.primary,
  },
  previewCard: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    minHeight: 160,
    ...webViewRtl,
  },
  previewLabel: {
    ...typography.caption,
    textAlign: rtlTextAlignStart,
    marginBottom: spacing.sm,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    width: '100%',
    ...webTextRtl,
  },
  previewSurface: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.xs,
    ...webViewRtl,
  },
  previewHeading: {
    ...typography.h4,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  previewBody: {
    ...typography.caption,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  previewChipsRow: {
    flexDirection: 'row' as const,
    gap: spacing.xs,
    marginTop: spacing.sm,
    ...webViewRtl,
  },
  previewChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  previewChipText: {
    ...typography.caption,
    ...typography.semiBold,
  },
}));
