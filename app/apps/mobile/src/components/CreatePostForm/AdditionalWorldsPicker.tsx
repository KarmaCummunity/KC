// Mapped to spec: #1475 (multi-world posts, docs/spec/07 §7.2).
// Allows the member to optionally mark a listing to appear in additional world feeds.
import React from 'react';
import { useTranslation } from 'react-i18next';
import { GIVING_WORLD_SLUGS, type GivingWorldSlug } from '@kc/domain';
import { makeUseStyles, spacing } from '@kc/ui';
import { FilterChipRow } from '../filterKit/FilterChipRow';
import { FormSection } from '../ui/FormSection';

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

  // Multi-select choices are giving worlds other than primary, excluding pure money donation.
  const candidates = GIVING_WORLD_SLUGS.filter(
    (w): w is GivingWorldSlug => w !== primaryWorldSlug && w !== 'money',
  );

  return (
    <FormSection
      label={t('post.unifiedCreate.additionalWorldsLabel')}
      hint={t('post.unifiedCreate.additionalWorldsHint')}
      style={styles.root}
      testID="additional-worlds-picker"
    >
      <FilterChipRow<string>
        multiSelect
        testID="additional-worlds-chips"
        testIDPrefix="additional-world"
        chipSize="md"
        disabled={disabled}
        options={candidates.map((slug) => ({ value: slug, label: t(`post.unifiedCreate.categories.${slug}`) }))}
        value={selectedWorlds}
        // The parent owns the list and toggles one world at a time: report the one that changed.
        onChange={(next) => {
          const toggled = candidates.find((slug) => next.includes(slug) !== selectedWorlds.includes(slug));
          if (toggled) onToggle(toggled);
        }}
      />
    </FormSection>
  );
}

const useStyles = makeUseStyles(() => ({
  root: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
}));
