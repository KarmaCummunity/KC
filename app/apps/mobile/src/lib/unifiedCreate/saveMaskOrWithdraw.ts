// Mapped to spec: FR-POST-021 — a listing published "hidden from the counterparty" must never stay
// live unmasked. The listing RPC publishes in one call and the owner's mask is a second write, so if
// that write fails the new listing is withdrawn and the error reaches the form: the member retries
// the same submit without leaving a duplicate or an unmasked post behind.
import { marketplaceRepository } from '../../services/marketplaceComposition';

export async function saveMaskOrWithdraw(listingId: string, saveMask: (id: string) => Promise<void>): Promise<void> {
  try {
    await saveMask(listingId);
  } catch (error) {
    // Best effort: the original failure is what the member must see, not a failed clean-up.
    await marketplaceRepository().deleteMyListing(listingId).catch(() => undefined);
    throw error;
  }
}
