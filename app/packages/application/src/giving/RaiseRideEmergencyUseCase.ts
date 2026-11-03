// Emergency during an active ride (docs/spec/05_giving_worlds.md §5.3 step 6, D70; gap G44).
// The server checks who may call, when, and how often, and alerts everyone else on the ride.
import type { IRideSafetyRepository } from '../ports/IRideSafetyRepository';

/** Longest note kept with an emergency (mirrors the server's check). */
const NOTE_MAX = 500;

export class RaiseRideEmergencyUseCase {
  constructor(private readonly repo: IRideSafetyRepository) {}
  execute(listingId: string, note?: string | null): Promise<void> {
    const trimmed = note?.trim() ?? '';
    return this.repo.raiseEmergency(listingId, trimmed ? trimmed.slice(0, NOTE_MAX) : null);
  }
}
