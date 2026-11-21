// FR-PROFILE-007 — city + city-dependent street picker + house number.
// When the user picks a different city the previously typed street + number
// reset to empty so a stale Tel Aviv street can never accompany a Jerusalem
// submission. The street-number input is editable only when a city is set. The block is one form
// section: a missing city or half an address is reported under it (FR-RESP-006 AC29).

import React, { useCallback } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing } from '@kc/ui';
import { CompactStreetNumberField } from './address/CompactStreetNumberField';
import { CityPicker } from './CityPicker';
import { StreetPicker } from './StreetPicker';
import { applyAddressResetOnCityChange } from '../lib/addressResetOnCityChange';
import { FormSection } from './ui/FormSection';
import { rtlTextAlignStart } from '../lib/rtlLayout';
export interface EditProfileAddressBlockProps {
  readonly city: { id: string; name: string } | null;
  readonly onCityChange: (v: { id: string; name: string } | null) => void;
  readonly street: string;
  readonly streetNumber: string;
  readonly onStreetChange: (v: string) => void;
  readonly onStreetNumberChange: (v: string) => void;
  readonly disabled: boolean;
  /** What is wrong with the address (missing city, street without number or the reverse). */
  readonly error?: string;
}

export function EditProfileAddressBlock({
  city,
  onCityChange,
  street,
  streetNumber,
  onStreetChange,
  onStreetNumberChange,
  disabled,
  error,
}: EditProfileAddressBlockProps) {
  const styles = useStyles();
  const { t } = useTranslation();

  const handleCityChange = useCallback(
    (next: { id: string; name: string } | null) => {
      const { street: nextStreet, streetNumber: nextNumber } =
        applyAddressResetOnCityChange({
          prevCityId: city?.id,
          nextCityId: next?.id,
          street,
          streetNumber,
        });
      if (nextStreet !== street) onStreetChange(nextStreet);
      if (nextNumber !== streetNumber) onStreetNumberChange(nextNumber);
      onCityChange(next);
    },
    [city?.id, street, streetNumber, onCityChange, onStreetChange, onStreetNumberChange],
  );

  const handleStreetChange = useCallback(
    (selection: { id: string; name: string }) => onStreetChange(selection.name),
    [onStreetChange],
  );

  return (
    <FormSection
      label={t('profile.addressLabel')}
      required
      error={error ?? null}
      outlined={false}
      style={styles.container}
      testID="edit-profile-address"
    >
      <View style={styles.field}>
        <CityPicker value={city} onChange={handleCityChange} disabled={disabled} />
      </View>
      <View style={styles.field}>
        <View style={styles.streetRow}>
          <View style={styles.streetCol}>
            <StreetPicker
              cityId={city?.id ?? null}
              value={street ? { id: '', name: street } : null}
              onChange={handleStreetChange}
              disabled={disabled}
            />
          </View>
          <CompactStreetNumberField
            containerStyle={styles.streetInputHouse}
            style={styles.streetNumberInput}
            value={streetNumber}
            onChangeText={onStreetNumberChange}
            editable={!disabled && !!city}
          />
        </View>
      </View>
    </FormSection>
  );
}

const useStyles = makeUseStyles(() => ({
  container: { width: '100%', maxWidth: 500, alignSelf: 'center' },
  field: { marginVertical: spacing.xs, gap: spacing.xs },
  streetRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', width: '100%' },
  streetCol: { flex: 2, minWidth: 0 },
  streetInputHouse: { flex: 1, minWidth: 0, maxWidth: 120 },
  streetNumberInput: { textAlign: rtlTextAlignStart },
}));
