// Mapped to spec: FR-POST-001 AC1 / AC6.
// Top of the unified create form: the category picker (one chip per giving world in a single
// horizontally scrolling row, the chosen one scrolled into view) and, under it, the request / offer
// toggle — which is hidden for worlds whose form is "add a link" (they have no give / take direction).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, makeUseStyles, spacing, useTheme, Text } from '@kc/ui';
import { Chip } from '../ui/Chip';
import { useCreatePostStyles } from '../../screens/tabs/create.styles';
import type {
  CreateCategoryConfig,
  CreateCategoryId,
  CreateDirection,
} from '../../lib/unifiedCreate/createCategories';

const useHeaderStyles = makeUseStyles(() => ({
  wrap: { gap: spacing.md },
  // Plain `row`: native mirrors it under forceRTL, so the first chip sits at the reading-start edge.
  chips: { flexDirection: 'row' as const, gap: spacing.xs },
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
  const scrollRef = useRef<ScrollView>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const chipBoxes = useRef<Record<string, { x: number; width: number }>>({});

  /** Scrolls the row so the given chip sits in the middle (or as near as the row's ends allow). */
  const centerChip = useCallback(
    (id: string) => {
      const box = chipBoxes.current[id];
      if (!box || viewportWidth === 0) return;
      scrollRef.current?.scrollTo({ x: Math.max(box.x + box.width / 2 - viewportWidth / 2, 0), animated: true });
    },
    [viewportWidth],
  );

  useEffect(() => centerChip(categoryId), [categoryId, centerChip]);

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
      {/* testID: Maestro swipes this row to reach chips beyond the screen edge (flow 13). */}
      <ScrollView
        ref={scrollRef}
        testID="create-category-row"
        horizontal
        showsHorizontalScrollIndicator={false}
        onLayout={(e) => setViewportWidth(e.nativeEvent.layout.width)}
        contentContainerStyle={header.chips}
      >
        {categories.map((c) => (
          <View
            key={c.id}
            onLayout={(e) => {
              const { x, width } = e.nativeEvent.layout;
              chipBoxes.current[c.id] = { x, width };
              if (c.id === categoryId) centerChip(c.id);
            }}
          >
            <Chip
              testID={`create-category-${c.id}`}
              icon={c.icon}
              label={t(c.labelKey)}
              selected={c.id === categoryId}
              onPress={() => onCategoryChange(c.id)}
            />
          </View>
        ))}
      </ScrollView>
      {showDirection ? (
        <View style={styles.typeToggle}>
          {toggle('request', 'search-outline', t('post.unifiedCreate.request'))}
          {toggle('give', 'gift-outline', t('post.unifiedCreate.offer'))}
        </View>
      ) : null}
    </View>
  );
}
