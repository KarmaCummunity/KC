// Mapped to spec: #1475 (multi-world posts, docs/spec/07 §7.2).
// Allows the member to optionally mark a listing to appear in additional world feeds.
import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GIVING_WORLD_SLUGS, type GivingWorldSlug } from '@kc/domain';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { useListingChipStyles } from '../marketplace/listingChipStyles';

interface Props {
  readonly primaryWorldSlug: string;
  readonly selectedWorlds: readonly string[];
  readonly onToggle: (worldSlug: string) => void;
  readonly disabled?: boolean;
}

export function AdditionalWorldsPicker({
  primaryWorldSlug,
  selectedWorlds,
  onToggle,
  disabled = false,
}: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const chipStyles = useListingChipStyles();

  // Multi-select choices are giving worlds other than primary, excluding pure money donation.
  const candidates = GIVING_WORLD_SLUGS.filter(
    (w): w is GivingWorldSlug => w !== primaryWorldSlug && w !== 'money',
  );

  return (
    <View style={styles.root} testID="additional-worlds-picker">
      <Text style={styles.label}>{t('post.unifiedCreate.additionalWorldsLabel')}</Text>
      <Text style={styles.hint}>{t('post.unifiedCreate.additionalWorldsHint')}</Text>
      <View style={chipStyles.chipRow}>
        {candidates.map((slug) => {
          const selected = selectedWorlds.includes(slug);
          return (
            <Pressable
              key={slug}
              testID={`additional-world-${slug}`}
              disabled={disabled}
              onPress={() => onToggle(slug)}
              style={[chipStyles.chip, selected && chipStyles.chipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled }}
            >
              <Text style={chipStyles.chipText}>
                {t(`post.unifiedCreate.categories.${slug}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
  },
  hint: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
  },
}));
