// Mapped to spec: FR-POST-001 AC6 — where a listing is. Every kind names its city; a kind that
// happens at a place (an event) takes the full address in the same section: city, street and
// house number, the parts an items post has. One section, so a form never shows an address
// field and a separate city field (KC#2288).
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing } from '@kc/ui';
import { CityPicker } from '../CityPicker';
import { StreetAddressRow } from '../address/StreetAddressRow';
import type { ListingStreetAddressForm } from '../../hooks/useListingStreetAddress';
import { useCreatePostStyles } from '../../screens/tabs/create.styles';
import { ListingFieldFrame } from './ListingFieldFrame';

interface Props {
  readonly city: { id: string; name: string } | null;
  readonly onCityChange: (city: { id: string; name: string } | null) => void;
  /** Street and house number; `enabled` is false for a kind that names its city only. */
  readonly address: ListingStreetAddressForm;
  readonly disabled: boolean;
}

export function ListingLocationSection({ city, onCityChange, address, disabled }: Props) {
  const { t } = useTranslation();
  const styles = useCreatePostStyles();
  const sectionStyles = useStyles();
  return (
    // A problem of any part (city, street, number) outlines the whole section: field "city".
    <ListingFieldFrame
      field="city"
      style={styles.section}
      contentStyle={sectionStyles.controls}
      testID="listing-location"
      label={t(address.enabled ? 'post.address' : 'post.unifiedCreate.cityLabel')}
      required
    >
      <CityPicker value={city} onChange={onCityChange} disabled={disabled} />
      {address.enabled ? (
        <View testID="listing-street-address">
          <StreetAddressRow
            cityId={city?.id ?? null}
            street={address.street}
            streetNumber={address.streetNumber}
            onStreetChange={address.setStreet}
            onStreetNumberChange={address.setStreetNumber}
            disabled={disabled}
            streetNumberPlaceholder={t('post.streetNumberShort')}
            streetNumberTestID="listing-street-number"
          />
        </View>
      ) : null}
    </ListingFieldFrame>
  );
}

const useStyles = makeUseStyles(() => ({
  controls: { gap: spacing.sm },
}));
