// Mapped to spec: FR-POST-001 AC1 / AC6.
// Top of the unified create form: the category picker (one chip per giving world in a single
// sideways row that scrolls in a circle, `CreateCategoryLoopRow`) and, under it, the request / offer
// toggle — which is hidden for worlds whose form is "add a link" (they have no give / take direction).
import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, makeUseStyles, spacing, useTheme, Text } from '@kc/ui';
import { CreateCategoryLoopRow } from './CreateCategoryLoopRow';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useCreatePostStyles } from '../../screens/tabs/create.styles';
import { ImportReviewNotice } from './ImportReviewNotice';
import type {
  CreateCategoryConfig,
  CreateCategoryId,
  CreateDirection,
} from '../../lib/unifiedCreate/createCategories';

const useHeaderStyles = makeUseStyles(() => ({
  wrap: { gap: spacing.md },
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
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useCreatePostStyles();
  const header = useHeaderStyles();
  // FR-IMPORT-001 AC4: the import entry exists only while the feature is switched on.
  const importEnabled = useFeatureFlag('external_post_import_enabled');
  /** One half of the request / offer toggle. */
  const toggle = (d: CreateDirection, icon: 'search-outline' | 'gift-outline', label: string) => {
    const on = direction === d;
    return (
      <TouchableOpacity
        testID={`create-direction-${d}`}
        style={[styles.typeBtn, on && styles.typeBtnActive]}
        onPress={() => onDirectionChange(d)}
        accessibilityRole="button"
        aria-selected={on}
      >
        <Ionicons name={icon} size={iconSize.md} color={on ? colors.textInverse : colors.textSecondary} />
        <Text style={[styles.typeBtnText, on && styles.typeBtnTextActive]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={header.wrap} testID="unified-create-header">
      {/* FR-IMPORT-007 AC2: shown only while the form holds a seeded import draft. */}
      <ImportReviewNotice />
      <Text style={styles.sectionLabel}>{t('post.unifiedCreate.categoryLabel')}</Text>
      <CreateCategoryLoopRow categories={categories} categoryId={categoryId} onCategoryChange={onCategoryChange} />
      {showDirection ? (
        <View style={styles.typeToggle}>
          {toggle('request', 'search-outline', t('post.unifiedCreate.request'))}
          {toggle('give', 'gift-outline', t('post.unifiedCreate.offer'))}
        </View>
      ) : null}
      {importEnabled ? (
        <TouchableOpacity testID="create-import-entry" onPress={() => router.push('/import-post')} accessibilityRole="button" accessibilityHint={t('postImport.entryHint')}>
          <Text style={styles.sectionLabel}>{t('postImport.entry')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
