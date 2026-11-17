// Optional world subcategory chips for the listing create form (items → books, food → bakery…).
// KC#1296 — the choice is sent as `p_category_id`; tapping the selected chip clears it.
// Renders nothing when the world has no subcategories or they failed to load.
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorldSubcategory } from '@kc/domain';
import { marketplaceRepository } from '../../services/marketplaceComposition';
import { FilterChipRow } from '../filterKit/FilterChipRow';
import { FormSection } from '../ui/FormSection';

interface Props {
  readonly worldSlug: string;
  readonly value: string | null;
  readonly onChange: (categoryId: string | null) => void;
  readonly disabled?: boolean;
}

export function WorldSubcategoryPicker({ worldSlug, value, onChange, disabled = false }: Props) {
  const { t, i18n } = useTranslation();
  const [subcategories, setSubcategories] = useState<WorldSubcategory[]>([]);

  useEffect(() => {
    let active = true;
    void marketplaceRepository()
      .listWorldSubcategories(worldSlug)
      .then((rows) => {
        if (active) setSubcategories(rows);
      });
    return () => {
      active = false;
    };
  }, [worldSlug]);

  if (subcategories.length === 0) return null;

  const hebrew = i18n.language.startsWith('he');
  return (
    <FormSection label={t('marketplace.fieldWorldSubcategory')} hint={t('marketplace.fieldWorldSubcategoryHint')}>
      <FilterChipRow<string>
        testID="world-subcategory-chips"
        chipSize="md"
        disabled={disabled}
        options={subcategories.map((s) => ({
          value: s.categoryId,
          label: hebrew ? s.labelHe : (s.labelEn ?? s.labelHe),
          testID: `world-subcategory-${s.slug}`,
        }))}
        value={value}
        // Optional choice: tapping the selected chip clears it.
        onChange={(next) => onChange(next === value ? null : next)}
      />
    </FormSection>
  );
}
