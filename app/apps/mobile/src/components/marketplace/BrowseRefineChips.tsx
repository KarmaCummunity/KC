// KC#1102 / KC#1111 — refine the hub's browse list: world subcategory chips (items / food, from the
// `categories` rows the create form uses) and a distance-from-home choice. `browse_listings` anchors
// on the viewer's home location, so the radius needs no device location permission.
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { marketplaceRepository } from '../../services/marketplaceComposition';
import { WORLDS_WITH_SUBCATEGORY_PICKER } from '../../lib/unifiedCreate/createCategories';
import { Chip } from '../ui/Chip';
import { useListingChipStyles } from './listingChipStyles';

/** Distance choices in km; 25 matches the server's default radius (`browse_listings`, 0410). */
export const BROWSE_RADIUS_OPTIONS_KM = [5, 10, 25, 50] as const;
export const DEFAULT_BROWSE_RADIUS_KM = 25;

interface Props {
  readonly worldSlug: string | null;
  readonly categoryId: string | null;
  readonly onCategoryChange: (categoryId: string | null) => void;
  readonly radiusKm: number;
  readonly onRadiusChange: (radiusKm: number) => void;
}

export function BrowseRefineChips({ worldSlug, categoryId, onCategoryChange, radiusKm, onRadiusChange }: Props) {
  const { t, i18n } = useTranslation();
  const chipStyles = useListingChipStyles();
  const hasSubcategories =
    worldSlug !== null && (WORLDS_WITH_SUBCATEGORY_PICKER as readonly string[]).includes(worldSlug);

  const subcategories = useQuery({
    queryKey: ['world-subcategories', worldSlug],
    queryFn: () => marketplaceRepository().listWorldSubcategories(worldSlug!),
    enabled: hasSubcategories,
    staleTime: 5 * 60_000,
  });
  const rows = hasSubcategories ? (subcategories.data ?? []) : [];
  const hebrew = i18n.language.startsWith('he');

  // Kit filter chips (spec 17 §4.1): one look for every refine row.
  const chip = (key: string, label: string, selected: boolean, onPress: () => void) => (
    <Chip key={key} testID={`browse-refine-${key}`} size="sm" label={label} selected={selected} onPress={onPress} />
  );

  return (
    <>
      {rows.length > 0 ? (
        <View style={chipStyles.chipRow} accessibilityLabel={t('marketplace.browseRefine.subcategoryRowA11y')}>
          {chip('subcategory-all', t('marketplace.browseRefine.allSubcategories'), categoryId === null, () =>
            onCategoryChange(null),
          )}
          {rows.map((s) =>
            chip(`subcategory-${s.slug}`, hebrew ? s.labelHe : (s.labelEn ?? s.labelHe), s.categoryId === categoryId, () =>
              onCategoryChange(s.categoryId),
            ),
          )}
        </View>
      ) : null}
      <View style={chipStyles.chipRow} accessibilityLabel={t('marketplace.browseRefine.radiusRowA11y')}>
        {BROWSE_RADIUS_OPTIONS_KM.map((km) =>
          chip(`radius-${km}`, t('marketplace.browseRefine.radius', { km }), km === radiusKm, () => onRadiusChange(km)),
        )}
      </View>
    </>
  );
}
