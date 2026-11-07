import type {
  HousingGuestStay,
  HousingHostBooking,
  HousingPrivateDetails,
  HousingStayRequestInput,
} from '@kc/domain';

/** The exact place a host writes for an offer (FR-HOUSING-012 AC2); street from the catalog (D71). */
export interface HousingPrivateDetailsInput {
  readonly listingId: string;
  readonly streetId: number;
  readonly houseNumber: string;
  readonly apartment?: string | null;
  readonly floor?: string | null;
  readonly entranceNotes?: string | null;
  readonly accessInstructions?: string | null;
  readonly lat?: number | null;
  readonly lng?: number | null;
}

/**
 * Housing stays on the server (docs/spec/requirements/21_housing.md FR-HOUSING-003, 012, 015–022;
 * migrations 0600–0603). Every write resolves once the server accepted it; server errors keep
 * their code as the message (e.g. `housing_capacity_exceeded`) so the UI maps them to copy, and
 * the server pushes every booking change to the other side.
 */
export interface IHousingRepository {
  /** The code-of-conduct version members must have accepted now (rules catalog, R-Housing-2). */
  currentConductVersion(): Promise<number>;
  /** Whether the signed-in member accepted the current version. */
  hasAcceptedConduct(): Promise<boolean>;
  /** Records the member's acceptance of `version` (refused when it is not the current one). */
  acceptConduct(version: number): Promise<void>;

  /** Guest requests a stay; resolves to the new booking (handoff) id. */
  requestStay(input: HousingStayRequestInput): Promise<string>;
  /** Host approves (`approve = true`) or declines a waiting booking, with an optional note. */
  decide(handoffId: string, approve: boolean, note: string | null): Promise<void>;
  /** Either side cancels before check-in; a host cancelling a confirmed stay gives a note. */
  cancel(handoffId: string, note: string | null): Promise<void>;
  /** Host marks the stay completed (check-in → check-out + 7 days); earns karma. */
  complete(handoffId: string): Promise<void>;
  /** Host marks a confirmed guest as not arrived (3 h → 24 h after check-in). */
  markNoShow(handoffId: string): Promise<void>;

  /** Host only: every live booking on one offer. */
  listForOffer(listingId: string): Promise<HousingHostBooking[]>;
  /** The member's own stays, newest first. */
  listMyStays(limit?: number): Promise<HousingGuestStay[]>;

  /** The exact place, for the host or the confirmed guest in the reveal window. */
  getPrivateDetails(listingId: string): Promise<HousingPrivateDetails | null>;
  /** Host writes the exact place; the server moves the public map point to its fuzzed point. */
  setPrivateDetails(input: HousingPrivateDetailsInput): Promise<void>;
}
