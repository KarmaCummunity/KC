// Ride times and seats in the create form (docs/spec/05_giving_worlds.md §5.3 step 1, D75, S46):
// departure with one-tap shortcuts, an estimated end suggested from the route (editable — once
// the driver changes it, it is no longer re-suggested), and seats for an offer (default 3, 1–8).
import React, { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import {
  RIDE_DEFAULT_SEATS,
  RIDE_DEPARTURE_SHORTCUTS,
  RIDE_MAX_SEATS,
  RIDE_MIN_SEATS,
  readRideRoute,
  rideDepartureFromShortcut,
  suggestRideArrival,
} from '@kc/domain';
import { DateTimeField } from '../ui/DateTimeField';

/** Detail keys owned by this block, hidden from the generic schema fields. */
export const RIDE_SCHEDULE_DETAIL_KEYS = ['departs_at', 'arrives_at', 'seats_available'] as const;

interface Props {
  readonly details: Record<string, unknown>;
  /** The form's state setter: effects update from the latest details, never a stale copy. */
  readonly onChange: Dispatch<SetStateAction<Record<string, unknown>>>;
  /** Offers have seats; requests count passengers in their own field. */
  readonly withSeats: boolean;
  readonly disabled?: boolean;
}

const asDate = (v: unknown): Date | null => {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function RideScheduleFields({ details, onChange, withSeats, disabled }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const departs = asDate(details.departs_at);
  const arrives = asDate(details.arrives_at);
  const seats = typeof details.seats_available === 'number' ? details.seats_available : null;
  // True once the driver picked the estimated end themselves: stop overwriting it.
  const arrivalEdited = useRef(false);
  const route = readRideRoute(details);
  const routeKey = [route.origin?.id, route.dest?.id, ...route.meetingPoints.map((p) => p.id)].join('|');

  // Offers start at the default seat count.
  useEffect(() => {
    if (withSeats && seats == null) onChange((prev) => ({ ...prev, seats_available: RIDE_DEFAULT_SEATS }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withSeats, seats == null]);

  // Re-suggest the estimated end whenever the departure or the route changes.
  useEffect(() => {
    if (arrivalEdited.current || !departs) return;
    const suggested = suggestRideArrival(departs, route);
    if (suggested && suggested.toISOString() !== details.arrives_at) {
      onChange((prev) => ({ ...prev, arrives_at: suggested.toISOString() }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details.departs_at, routeKey]);

  const setSeats = (next: number) => {
    if (next >= RIDE_MIN_SEATS && next <= RIDE_MAX_SEATS) onChange((prev) => ({ ...prev, seats_available: next }));
  };

  return (
    <View style={styles.block}>
      <DateTimeField
        testID="ride-departs-at"
        label={t('rideSchedule.departure')}
        value={departs}
        minimumDate={new Date()}
        disabled={disabled}
        onChange={(d) => onChange((prev) => ({ ...prev, departs_at: d.toISOString() }))}
        shortcuts={RIDE_DEPARTURE_SHORTCUTS.map((key) => ({
          key,
          label: t(`rideSchedule.shortcut.${key}`),
          at: () => rideDepartureFromShortcut(key, new Date()),
        }))}
      />
      <DateTimeField
        testID="ride-arrives-at"
        label={t('rideSchedule.arrival')}
        placeholder={t('rideSchedule.arrivalPlaceholder')}
        value={arrives}
        minimumDate={departs ?? undefined}
        disabled={disabled}
        onChange={(d) => {
          arrivalEdited.current = true;
          onChange((prev) => ({ ...prev, arrives_at: d.toISOString() }));
        }}
      />
      {arrives && !arrivalEdited.current ? <Text style={styles.hint}>{t('rideSchedule.arrivalHint')}</Text> : null}

      {withSeats ? (
        <View style={styles.seatsRow}>
          <Text style={styles.label}>{t('rideSchedule.seats')}</Text>
          <View style={styles.stepper}>
            <StepButton label="−" a11y={t('rideSchedule.fewerSeats')} disabled={disabled || (seats ?? 0) <= RIDE_MIN_SEATS} onPress={() => setSeats((seats ?? RIDE_DEFAULT_SEATS) - 1)} />
            <Text style={styles.seatsValue} testID="ride-seats">{seats ?? RIDE_DEFAULT_SEATS}</Text>
            <StepButton label="+" a11y={t('rideSchedule.moreSeats')} disabled={disabled || (seats ?? 0) >= RIDE_MAX_SEATS} onPress={() => setSeats((seats ?? RIDE_DEFAULT_SEATS) + 1)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function StepButton({ label, a11y, disabled, onPress }: Readonly<{ label: string; a11y: string; disabled: boolean; onPress: () => void }>) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={[styles.stepBtn, disabled ? styles.stepBtnOff : null]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={styles.seatsValue}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  block: { gap: spacing.sm },
  hint: { ...typography.caption, color: colors.textSecondary },
  label: { ...typography.caption, color: colors.textSecondary },
  seatsRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  stepper: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  stepBtn: {
    width: spacing['2xl'] + spacing.sm,
    height: spacing['2xl'] + spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  stepBtnOff: { opacity: 0.4 },
  seatsValue: { ...typography.h3, color: colors.textPrimary, textAlign: 'center' as const },
}));
