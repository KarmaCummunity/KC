import type { RidePlace } from '@kc/domain';

/** Wire format for `book_ride_seat.p_requested_meeting_point`. */
export function ridePlaceToMeetingPointPayload(place: RidePlace): Record<string, unknown> {
  return {
    kind: place.kind,
    id: place.id,
    label: place.label,
    lat: place.lat,
    lng: place.lng,
    city_id: place.cityId,
  };
}
