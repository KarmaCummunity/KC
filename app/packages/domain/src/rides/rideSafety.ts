// Safety rules of the one rides flow (docs/spec/05_giving_worlds.md §5.3 step 6 and "Rules",
// D70; gap G44). They mirror the server (0517), which enforces them; the app uses them to
// show the cap and to offer the emergency button only while a ride is under way.

/** No profit: a ride's cost share is at most this much inside one city… */
export const RIDE_COST_CAP_URBAN_ILS = 20;
/** …and at most this much between cities. */
export const RIDE_COST_CAP_INTERCITY_ILS = 70;

const HOUR_MS = 60 * 60_000;

const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const time = (v: unknown): number | null => {
  const at = typeof v === 'string' ? Date.parse(v) : Number.NaN;
  return Number.isNaN(at) ? null : at;
};

/** The cost-share cap for a ride's route: urban when both ends are in the same city. */
export function rideCostShareCap(details: Record<string, unknown>): number {
  const origin = text(details.origin_city_id);
  return origin && origin === text(details.dest_city_id) ? RIDE_COST_CAP_URBAN_ILS : RIDE_COST_CAP_INTERCITY_ILS;
}

/**
 * Whether a ride is under way for the emergency button: from 1 hour before departure until
 * 2 hours after the estimated end (or 8 hours after departure when there is no end).
 */
export function isRideEmergencyWindow(details: Record<string, unknown>, now: Date): boolean {
  const departs = time(details.departs_at);
  if (departs == null) return false;
  const until = (time(details.arrives_at) ?? departs + 6 * HOUR_MS) + 2 * HOUR_MS;
  return now.getTime() >= departs - HOUR_MS && now.getTime() <= until;
}
