// Ride route in the create form: origin, destination and up to 3 meeting points, each an
// official place (city + optional street, or junction / interchange — D71; gap G45).
// Writes the route keys of the ride details; the server re-resolves every place on save.
import React, { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import {
  RIDE_MAX_MEETING_POINTS,
  nearestCityPlace,
  readRideRoute,
  withMeetingPoints,
  withRidePlace,
  type RidePlace,
} from '@kc/domain';
import { useMyLocation } from '../../hooks/useMyLocation';
import { useRidePlaces } from '../../hooks/useRidePlaces';
import { hapticLightTap } from '../../lib/haptics';
import { RideOptionSwitch } from './RideOptionSwitch';
import { RidePlaceField } from './RidePlaceField';

const useStyles = makeUseStyles(({ colors }) => ({
  section: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm, textAlign: rtlTextAlignStart },
  link: { ...typography.button, color: colors.primary, paddingVertical: spacing.xs, textAlign: rtlTextAlignStart },
  remove: { ...typography.caption, color: colors.error, paddingVertical: spacing.xs, textAlign: rtlTextAlignStart },
  point: { gap: spacing.xs },
}));

type City = { id: string; name: string };

interface Props {
  details: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** Called with the origin's city (a junction's nearest city) to suggest the listing city. */
  onOriginCity?: (city: City) => void;
  disabled?: boolean;
}

export function RideRouteFields({ details, onChange, onOriginCity, disabled }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const places = useRidePlaces();
  const catalog = places.data ?? null;
  const route = readRideRoute(details);
  // An empty picker for the next meeting point, shown after "add" until a place is chosen.
  const [addingPoint, setAddingPoint] = useState(false);
  // "From my current location" (#1411): on while the origin is the city nearest the device.
  const { locate } = useMyLocation();
  const [fromHere, setFromHere] = useState(false);
  const [locationFailed, setLocationFailed] = useState(false);
  // The latest details, so a place found after the location read lands on what the member typed since.
  const latest = useRef(details);
  latest.current = details;

  const field = { places: catalog, isLoading: places.isLoading, error: places.error, onRetry: () => void places.refetch(), disabled };

  const reportOriginCity = (place: RidePlace) => {
    if (!onOriginCity || !catalog) return;
    const city = place.cityId
      ? catalog.find((p) => p.kind === 'city' && p.id === place.cityId)
      : nearestCityPlace(place.lat, place.lng, catalog);
    if (city) onOriginCity({ id: city.id, name: city.label });
  };

  const setEnd = (end: 'origin' | 'dest', place: RidePlace) => {
    hapticLightTap();
    onChange(withRidePlace(latest.current, end, place));
    if (end === 'origin') reportOriginCity(place);
  };

  const pickOrigin = (place: RidePlace) => {
    setFromHere(false);
    setLocationFailed(false);
    setEnd('origin', place);
  };

  const originFromHere = async (on: boolean) => {
    setLocationFailed(false);
    setFromHere(on);
    if (!on) return;
    const here = await locate();
    const city = here && catalog ? nearestCityPlace(here.lat, here.lng, catalog) : null;
    if (city) {
      setEnd('origin', city);
    } else {
      setFromHere(false);
      setLocationFailed(true);
    }
  };

  const setPoints = (points: readonly RidePlace[]) => {
    hapticLightTap();
    onChange(withMeetingPoints(details, points));
  };

  const points = route.meetingPoints;
  return (
    <>
      <RideOptionSwitch
        testID="ride-origin-from-here"
        label={t('ridePlaces.fromCurrentLocation')}
        hint={locationFailed ? t('ridePlaces.locationUnavailable') : null}
        value={fromHere}
        onValueChange={(on) => void originFromHere(on)}
        disabled={disabled}
      />
      <RidePlaceField label={t('ridePlaces.fieldOrigin')} value={route.origin} onChange={pickOrigin} {...field} />
      <RidePlaceField label={t('ridePlaces.fieldDest')} value={route.dest} onChange={(p) => setEnd('dest', p)} {...field} />

      <Text style={styles.section}>{t('ridePlaces.meetingPointsTitle')}</Text>
      {points.map((point, i) => (
        <View key={`${point.kind}:${point.id}`} style={styles.point}>
          <RidePlaceField
            label={t('ridePlaces.meetingPointLabel', { n: i + 1 })}
            value={point}
            onChange={(p) => setPoints(points.map((q, j) => (j === i ? p : q)))}
            {...field}
          />
          <Pressable
            accessibilityRole="button"
            testID={`ride-meeting-point-remove-${i}`}
            disabled={disabled}
            onPress={() => setPoints(points.filter((_, j) => j !== i))}
          >
            <Text style={styles.remove}>{t('ridePlaces.removeMeetingPoint')}</Text>
          </Pressable>
        </View>
      ))}
      {addingPoint ? (
        <RidePlaceField
          label={t('ridePlaces.meetingPointLabel', { n: points.length + 1 })}
          value={null}
          onChange={(p) => {
            setAddingPoint(false);
            setPoints([...points, p]);
          }}
          {...field}
        />
      ) : null}
      {!addingPoint && points.length < RIDE_MAX_MEETING_POINTS ? (
        <Pressable
          accessibilityRole="button"
          testID="ride-meeting-point-add"
          disabled={disabled}
          onPress={() => setAddingPoint(true)}
        >
          <Text style={styles.link}>{t('ridePlaces.addMeetingPoint')}</Text>
        </Pressable>
      ) : null}
    </>
  );
}
