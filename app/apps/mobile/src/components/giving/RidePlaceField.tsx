// One ride place: a city or junction / interchange from the official catalog, and — for a
// city — an optional street from the official street list. No free text anywhere (D71).
// A street place is pinned at its city (streets have no coordinates of their own).
import React from 'react';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, typography, Text } from '@kc/ui';
import { streetPlaceId, type RidePlace } from '@kc/domain';
import { SearchablePicker } from '../SearchablePicker/SearchablePicker';
import { StreetPicker } from '../StreetPicker';

const useStyles = makeUseStyles(({ colors }) => ({
  label: { ...typography.caption, color: colors.textSecondary },
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
}

/** Picker row key: kind and id together, since a city and a junction may share an id. */
const placeKey = (p: Pick<RidePlace, 'kind' | 'id'>) => `${p.kind}:${p.id}`;
const matchPlace = (p: RidePlace, q: string) => p.label.includes(q.trim());
const renderPlace = (p: RidePlace) => ({ id: placeKey(p), name: p.label });

export function RidePlaceField({ label, value, places, isLoading, error, onChange, onRetry, disabled }: Props) {
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
    </>
  );
}
