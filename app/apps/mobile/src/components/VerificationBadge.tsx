// FR-VERIFY-001 AC2/AC3 — one check-mark shape, color per level; renders nothing at level 0.
import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { iconSize, useTheme, type ColorPalette } from '@kc/ui';
import type { VerificationLevel } from '@kc/domain';

const LEVEL_COLOR: Record<Exclude<VerificationLevel, 0>, keyof ColorPalette> = {
  1: 'success',
  2: 'info',
  3: 'warning',
};

export interface VerificationBadgeProps {
  readonly level: VerificationLevel | undefined;
  readonly size?: number;
}

export function VerificationBadge({ level, size = iconSize.sm }: VerificationBadgeProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  if (!level) return null;
  return (
    <Ionicons
      name="checkmark-circle"
      size={size}
      color={colors[LEVEL_COLOR[level]] as string}
      accessibilityRole="image"
      accessibilityLabel={t(`verification.level.${level}`)}
      testID={`verification-badge-${level}`}
    />
  );
}
