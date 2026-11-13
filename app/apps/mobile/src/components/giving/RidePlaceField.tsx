// One ride place: a city or junction / interchange from the official catalog, and — for a
// city — an optional street from the official street list. No free text anywhere (D71).
// A street place is pinned at its city (streets have no coordinates of their own).
import React from 'react';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { inputTextAlignStart } from '../../lib/rtlLayout';
import { RIDE_HOUSE_NUMBER_MAX_LENGTH, streetPlaceId, type RidePlace } from '@kc/domain';
import { SearchablePicker } from '../SearchablePicker/SearchablePicker';
import { StreetPicker } from '../StreetPicker';
import { TextField } from '../ui/TextField';

const useStyles = makeUseStyles(({ colors }) => ({
  label: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  // A number keeps a fixed direction (FR-RESP-006 AC21), pinned to the reading start.
  houseNumber: { textAlign: inputTextAlignStart() },
}));

interface Props {
  readonly label: string;
  readonly value: RidePlace | null;
  /** The catalog to pick from (cities and junctions); null while it loads. */
  readonly places: readonly RidePlace[] | null;
  readonly isLoading: boolean;
  readonly error: unknown;
  readonly onChange: (place: RidePlace) => void;
  readonly onRetry?: () => void;
  readonly disabled?: boolean;
  /** Private house number of a street place (FR-RIDE-003 AC9); the box shows only with a handler. */
  readonly houseNumber?: string;
  readonly onHouseNumberChange?: (value: string) => void;
  readonly houseNumberTestID?: string;
}

/** Picker row key: kind and id together, since a city and a junction may share an id. */
const placeKey = (p: Pick<RidePlace, 'kind' | 'id'>) => `${p?.kind ?? ''}:${p?.id ?? ''}`;
const matchPlace = (p: RidePlace, q: string) => {
  if (!p) return false;
  const trimmed = (q ?? '').trim();
  if (!trimmed) return true;
  return (p.label ?? '').includes(trimmed);
};
const renderPlace = (p: RidePlace) => ({ id: placeKey(p), name: p?.label ?? '' });

export function RidePlaceField({
  label,
  value,
  places,
  isLoading,
  error,
  onChange,
  onRetry,
  disabled,
  houseNumber,
  onHouseNumberChange,
  houseNumberTestID,
}: Props) {
  const { t } = useTranslation();
  const styles = useStyles();

  // A street's catalog part is its city; the street itself is the second step.
  const base: RidePlace | null =
    value?.kind === 'street'
      ? (places?.find((p) => p.kind === 'city' && p.id === value.cityId) ?? null)
      : value;
  const street =
    value?.kind === 'street' && base
      ? { id: value.id.split(':')[1] ?? '', name: value.label.replace(`, ${base.label}`, '') }
      : null;

  const pickBase = (selection: { id: string }) => {
    const place = places?.find((p) => placeKey(p) === selection.id);
    if (place) onChange(place);
  };

  const pickStreet = (selection: { id: string; name: string }) => {
    if (base?.kind !== 'city') return;
    onChange({
      kind: 'street',
      id: streetPlaceId(base.id, selection.id),
      label: `${selection.name}, ${base.label}`,
      lat: base.lat,
      lng: base.lng,
      cityId: base.id,
    });
  };

  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <SearchablePicker<RidePlace>
        title={t('ridePlaces.pickerTitle')}
        placeholder={t('ridePlaces.pickerSearch')}
        value={base ? renderPlace(base) : null}
        items={places}
        isLoading={isLoading}
        error={error}
        disabled={disabled}
        onSelect={pickBase}
        matchItem={matchPlace}
        renderRow={renderPlace}
        emptyText={t('ridePlaces.pickerEmpty')}
        errorText={t('ridePlaces.pickerError')}
        onErrorRetry={onRetry}
      />
      {base?.kind === 'city' ? (
        <>
          <Text style={styles.label}>{t('ridePlaces.streetOptional')}</Text>
          <StreetPicker cityId={base.id} value={street} onChange={pickStreet} disabled={disabled} allowFreeText={false} />
        </>
      ) : null}
      {value?.kind === 'street' && onHouseNumberChange ? (
        <TextField
          hideLabel
          label={t('ridePlaces.houseNumberPlaceholder')}
          placeholder={t('ridePlaces.houseNumberPlaceholder')}
          helperText={t('ridePlaces.houseNumberPrivateHint')}
          value={houseNumber ?? ''}
          onChangeText={onHouseNumberChange}
          maxLength={RIDE_HOUSE_NUMBER_MAX_LENGTH}
          editable={!disabled}
          style={styles.houseNumber}
          testID={houseNumberTestID}
          inputKind="streetNumber"
        />
      ) : null}
    </>
  );
}
