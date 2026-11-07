// FR-PROFILE-007 — city + city-dependent street picker + house number.
// When the user picks a different city the previously typed street + number
// reset to empty so a stale Tel Aviv street can never accompany a Jerusalem
// submission. The street-number input is editable only when a city is set.

import React, { useCallback } from 'react';
import { View } from 'react-native';
import type { TextInput as KitTextInput } from '@kc/ui';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { TextField, type TextFieldProps } from './ui/TextField';
import { CityPicker } from './CityPicker';
import { StreetPicker } from './StreetPicker';
import { applyAddressResetOnCityChange } from '../lib/addressResetOnCityChange';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';

export interface EditProfileAddressBlockProps {
  readonly city: { id: string; name: string } | null;
  readonly onCityChange: (v: { id: string; name: string } | null) => void;
  readonly street: string;
  readonly streetNumber: string;
  readonly onStreetChange: (v: string) => void;
  readonly onStreetNumberChange: (v: string) => void;
  readonly disabled: boolean;
  /** Optional keyboard-toolbar bindings for the house-number field. */
  readonly streetNumberInputProps?: Pick<
    TextFieldProps,
    'onFocus' | 'inputAccessoryViewID' | 'returnKeyType' | 'blurOnSubmit' | 'onSubmitEditing'
  >;
  readonly streetNumberRef?: React.RefObject<KitTextInput | null>;
}

export function EditProfileAddressBlock({
  city,
  onCityChange,
  street,
  streetNumber,
  onStreetChange,
  onStreetNumberChange,
  disabled,
  streetNumberInputProps,
  streetNumberRef,
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
    <View style={styles.container}>
      <View style={styles.field}>
        <Text style={styles.label}>{t('profile.addressLabel')}</Text>
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
          <TextField
            ref={streetNumberRef}
            containerStyle={styles.streetInputHouse}
            label={t('profile.streetNumberShort')}
            value={streetNumber}
            onChangeText={onStreetNumberChange}
            placeholder={t('profile.streetNumberShort')}
            editable={!disabled && !!city}
            maxLength={10}
            {...streetNumberInputProps}
          />
        </View>
      </View>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  container: { width: '100%', maxWidth: 500, alignSelf: 'center' },
  field: { marginVertical: spacing.xs, gap: spacing.xs },
  label: { ...typography.label, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  streetRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', width: '100%' },
  streetCol: { flex: 2, minWidth: 0 },
  streetInputHouse: { flex: 1, minWidth: 0, maxWidth: 120 },
}));
