// Mapped to spec: FR-POST-001 AC1 / AC6.
// Top of the unified create form: the category picker (one tile per giving world, wrapped into
// rows of four, no horizontal scrolling) and, under it, the request / offer toggle — which is
// hidden for worlds whose form is "add a link" (they have no give / take direction).
import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { useCreatePostStyles } from '../../screens/tabs/create.styles';
import type {
  CreateCategoryConfig,
  CreateCategoryId,
  CreateDirection,
} from '../../lib/unifiedCreate/createCategories';

const useHeaderStyles = makeUseStyles(({ colors }) => ({
  wrap: { gap: spacing.md },
  tiles: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.xs },
  // Four per row: grow to share the row, but never narrower than a quarter minus the gaps.
  tile: {
    flexGrow: 1,
    flexBasis: '22%' as const,
    alignItems: 'center' as const,
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tileOn: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
  tileText: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' as const },
  tileTextOn: { ...typography.bold, color: colors.primary },
}));

interface Props {
  readonly categories: readonly CreateCategoryConfig[];
  readonly categoryId: CreateCategoryId;
  readonly onCategoryChange: (id: CreateCategoryId) => void;
  /** False for worlds without a give / take direction (the link form). */
  readonly showDirection: boolean;
  readonly direction: CreateDirection;
  readonly onDirectionChange: (d: CreateDirection) => void;
}

export function UnifiedCreateHeader({
  categories,
  categoryId,
  onCategoryChange,
  showDirection,
  direction,
  onDirectionChange,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useCreatePostStyles();
  const header = useHeaderStyles();

  /** One half of the request / offer toggle. */
  const toggle = (d: CreateDirection, icon: 'search-outline' | 'gift-outline', label: string) => {
    const on = direction === d;
    const activeStyle = d === 'give' ? styles.typeBtnActiveGive : styles.typeBtnActive;
    return (
      <TouchableOpacity
        testID={`create-direction-${d}`}
        style={[styles.typeBtn, on && activeStyle]}
        onPress={() => onDirectionChange(d)}
        accessibilityRole="button"
        aria-selected={on}
      >
        <Ionicons name={icon} size={iconSize.md} color={on ? colors.textPrimary : colors.textSecondary} />
        <Text style={[styles.typeBtnText, on && styles.typeBtnTextActive]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={header.wrap} testID="unified-create-header">
      <Text style={styles.sectionLabel}>{t('post.unifiedCreate.categoryLabel')}</Text>
      <View style={header.tiles} accessibilityRole="radiogroup">
        {categories.map((c) => {
          const on = c.id === categoryId;
          return (
            <TouchableOpacity
              key={c.id}
              testID={`create-category-${c.id}`}
              style={[header.tile, on && header.tileOn]}
              onPress={() => onCategoryChange(c.id)}
              accessibilityRole="radio"
              aria-checked={on}
            >
              <Ionicons name={c.icon} size={iconSize.xl} color={on ? colors.primary : colors.textSecondary} />
              <Text style={[header.tileText, on && header.tileTextOn]} numberOfLines={1}>
                {t(c.labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {showDirection ? (
        <View style={styles.typeToggle}>
          {toggle('request', 'search-outline', t('post.unifiedCreate.request'))}
          {toggle('give', 'gift-outline', t('post.unifiedCreate.offer'))}
        </View>
      ) : null}
    </View>
  );
}
