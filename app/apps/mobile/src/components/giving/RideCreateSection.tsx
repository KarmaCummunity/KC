// The rides part of the create form: route (official places, D71), schedule (D75) and the
// "recurring ride" switch (FR-RIDE-046), started from "publish again" or the last route this device
// published (spec 05 §5.3 step 1; G49).
import React, { useEffect, type Dispatch, type SetStateAction } from 'react';
import { RIDE_ROUTE_DETAIL_KEYS, type RideHouseNumbers } from '@kc/domain';
import { takeRideStartDetails } from '../../lib/rides/rideStartDetails';
import { RideRouteFields } from './RideRouteFields';
import { RIDE_SCHEDULE_DETAIL_KEYS, RideScheduleFields } from './RideScheduleFields';
import { RideRecurrenceFields, type RideRecurrenceDraft } from './RideRecurrenceFields';
import { ListingFieldFrame } from '../CreatePostForm/ListingFieldFrame';

/** Ride detail keys the generic schema fields must not render a second time. */
export const RIDE_CREATE_DETAIL_KEYS: readonly string[] = [...RIDE_ROUTE_DETAIL_KEYS, ...RIDE_SCHEDULE_DETAIL_KEYS];

interface Props {
  readonly details: Record<string, unknown>;
  readonly setDetails: Dispatch<SetStateAction<Record<string, unknown>>>;
  readonly onOriginCity: (city: { id: string; name: string }) => void;
  /** Ride offers carry seats; ride requests do not. */
  readonly isOffer: boolean;
  /** The recurring-ride draft; null publishes a single ride. */
  readonly recurrence: RideRecurrenceDraft | null;
  readonly onRecurrenceChange: (next: RideRecurrenceDraft | null) => void;
  /** "Leave now": depart a few minutes after publishing (#1411). */
  readonly leaveNow: boolean;
  readonly onLeaveNowChange: (on: boolean) => void;
  /** "From my current location" turned on or off for the origin (#1411). */
  readonly onOriginFromHereChange?: (on: boolean) => void;
  /** Private house numbers (FR-RIDE-003 AC9); single rides only, so hidden while recurring. */
  readonly houseNumbers?: RideHouseNumbers;
  readonly onHouseNumbersChange?: (next: RideHouseNumbers) => void;
  readonly disabled?: boolean;
}

/** Rides are free for now (spec 05 §5.3): a past ride's cost terms are not carried over. */
function withoutCost(seed: Record<string, unknown>): Record<string, unknown> {
  const { reward_model: _model, cost_share_ils: _amount, ...rest } = seed;
  return rest;
}

/** The departure picked in the schedule block, as a date; null until picked. */
function departureOf(details: Record<string, unknown>): Date | null {
  const raw = details.departs_at;
  if (typeof raw !== 'string' || !raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function RideCreateSection({
  details,
  setDetails,
  onOriginCity,
  isOffer,
  recurrence,
  onRecurrenceChange,
  leaveNow,
  onLeaveNowChange,
  onOriginFromHereChange,
  houseNumbers,
  onHouseNumbersChange,
  disabled,
}: Props) {
  // Start from the queued "publish again" ride or the remembered route, once per form.
  // What the user already typed wins over the seed.
  useEffect(() => {
    let cancelled = false;
    void takeRideStartDetails().then((seed) => {
      if (!cancelled && seed) setDetails((prev) => ({ ...withoutCost(seed), ...prev }));
    });
    return () => {
      cancelled = true;
    };
  }, [setDetails]);

  return (
    <>
      <RideRouteFields
        details={details}
        onChange={setDetails}
        onOriginCity={onOriginCity}
        onFromHereChange={onOriginFromHereChange}
        houseNumbers={houseNumbers}
        onHouseNumbersChange={recurrence ? undefined : onHouseNumbersChange}
        disabled={disabled}
      />
      <RideScheduleFields
        details={details}
        onChange={setDetails}
        withSeats={isOffer}
        leaveNow={leaveNow}
        onLeaveNowChange={onLeaveNowChange}
        disabled={disabled}
      />
      <ListingFieldFrame field="ride:recurrence">
        <RideRecurrenceFields value={recurrence} onChange={onRecurrenceChange} departsAt={departureOf(details)} disabled={disabled} />
      </ListingFieldFrame>
    </>
  );
}
