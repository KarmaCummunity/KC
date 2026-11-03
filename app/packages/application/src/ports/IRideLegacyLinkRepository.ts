/** Links from the retired `ride_listings` rides to their listings (docs/spec/05_giving_worlds.md §5.3, D70). */
export interface IRideLegacyLinkRepository {
  /** The listing a legacy ride was mirrored into, or null when there is none (or it is hidden). */
  listingIdForLegacyRide(rideId: string): Promise<string | null>;
}
