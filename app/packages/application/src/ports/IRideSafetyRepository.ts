/** Safety on the one rides flow (docs/spec/05_giving_worlds.md §5.3 step 6, D70). */
export interface IRideSafetyRepository {
  /** The driver or an approved passenger calls for help during the ride. */
  raiseEmergency(listingId: string, note: string | null): Promise<void>;
}
