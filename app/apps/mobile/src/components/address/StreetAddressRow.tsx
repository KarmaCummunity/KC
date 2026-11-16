// The street and house-number row of a post's address: the street picker of the chosen city with
// the compact number box beside it. One component for every form that takes a full address
// (edit post, the event form), so the two controls look and behave the same everywhere.
// Both controls stay disabled until a city is chosen: the street list belongs to the city.
import React from 'react';
import { View } from 'react-native';
import { makeUseStyles, spacing } from '@kc/ui';
import { StreetPicker } from '../StreetPicker';
import { CompactStreetNumberField } from './CompactStreetNumberField';

interface Props {
  /** Id of the chosen city; null while none is chosen. */
  readonly cityId: string | null;
  readonly street: string;
  readonly streetNumber: string;
  readonly onStreetChange: (street: string) => void;
  readonly onStreetNumberChange: (streetNumber: string) => void;
  readonly disabled?: boolean;
  /** Placeholder of the number box; the field has its own default. */
  readonly streetNumberPlaceholder?: string;
  readonly streetNumberTestID?: string;
}

export function StreetAddressRow({
  cityId,
  street,
  streetNumber,
  onStreetChange,
  onStreetNumberChange,
  disabled = false,
  streetNumberPlaceholder,
  streetNumberTestID,
}: Props) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <View style={styles.street}>
        <StreetPicker
          cityId={cityId}
          // The picker identifies a street by name; the id is not stored with a post.
          value={street ? { id: '', name: street } : null}
          onChange={(selected) => onStreetChange(selected.name)}
          disabled={disabled}
        />
      </View>
      <CompactStreetNumberField
        testID={streetNumberTestID}
        containerStyle={styles.number}
        value={streetNumber}
        onChangeText={onStreetNumberChange}
        placeholder={streetNumberPlaceholder}
        editable={!disabled && cityId !== null}
      />
    </View>
  );
}

const useStyles = makeUseStyles(() => ({
  row: { flexDirection: 'row' as const, gap: spacing.sm, alignItems: 'stretch' as const },
  street: { flex: 2, minWidth: 0 },
  number: { flex: 1, minWidth: 0, maxWidth: 120 },
}));
