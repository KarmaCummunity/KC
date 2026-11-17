// Mapped to spec: FR-POST-001 AC6 — pure shaping of the listing create form's details.
import { RIDE_CREATE_DETAIL_KEYS } from '../../components/giving/RideCreateSection';
import type { OrgEventChoice } from '../../hooks/useOrgEventChoice';

/** Rides have no title field (#1411): the title is built from the route, e.g. "Lod → Tel Aviv". */
export function rideAutoTitle(
  details: Readonly<Record<string, unknown>>,
  format: (origin: string, dest: string) => string,
): string {
  const origin = typeof details.origin_label === 'string' ? details.origin_label.trim() : '';
  const dest = typeof details.dest_label === 'string' ? details.dest_label.trim() : '';
  return origin && dest ? format(origin, dest) : '';
}

/** An organization's event carries the organization it is published for (`details.org_id`). */
export function withEventOrg(details: Record<string, unknown>, choice: OrgEventChoice): Record<string, unknown> {
  return choice.isOrgEvent && choice.orgId ? { ...details, org_id: choice.orgId } : details;
}

/**
 * An event shows its place as one line built from the structured address ("Herzl 12"). `label`
 * is null for a kind without a street address, whose details are returned as they are; an event
 * always gets the current line, so an older free-text address never survives an edit.
 */
export function withEventAddress(details: Record<string, unknown>, label: string | null): Record<string, unknown> {
  if (label === null) return details;
  const { address: _replaced, ...rest } = details;
  return label ? { ...rest, address: label } : rest;
}

/** The ride route + schedule of `details` (empty for every other world). */
export function pickRideDetails(details: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of RIDE_CREATE_DETAIL_KEYS) if (key in details) out[key] = details[key];
  return out;
}
