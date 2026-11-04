// Housing stay booking use cases (docs/spec/requirements/21_housing.md FR-HOUSING-015…022).
// The server RPCs (0602–0603) own authorization and state; these reject what the domain rules
// already know is invalid, so the member gets the answer without a round trip, then delegate.
import {
  HOUSING_NOTE_MAX,
  HousingError,
  hostBookingActions,
  validateStayRequest,
  type HousingGuestStay,
  type HousingHostBooking,
  type HousingOfferTerms,
  type HousingStayRequestInput,
} from '@kc/domain';
import type { IHousingRepository } from '../ports/IHousingRepository';

/** Normalizes an optional note: blank becomes null; longer than 300 characters is refused. */
function normalizedNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim() ?? '';
  if (trimmed.length > HOUSING_NOTE_MAX) {
    throw new HousingError('housing_note_too_long', 'note is longer than 300 characters');
  }
  return trimmed.length > 0 ? trimmed : null;
}

export class RequestHousingStayUseCase {
  constructor(private readonly repo: IHousingRepository) {}
  /** `today` is the current Israel day (`yyyy-MM-dd`), the day the server compares against. */
  async execute(input: HousingStayRequestInput, terms: HousingOfferTerms, today: string): Promise<string> {
    const broken = validateStayRequest(input, terms, today);
    if (broken) throw new HousingError(broken, `stay request breaks ${broken}`);
    return this.repo.requestStay({ ...input, message: input.message.trim() });
  }
}

export class DecideHousingBookingUseCase {
  constructor(private readonly repo: IHousingRepository) {}
  async execute(booking: HousingHostBooking, approve: boolean, note?: string | null): Promise<void> {
    if (booking.status !== 'reserved') {
      throw new HousingError('invalid_status', 'only a waiting booking can be decided');
    }
    return this.repo.decide(booking.handoffId, approve, normalizedNote(note));
  }
}

export class CancelHousingBookingUseCase {
  constructor(private readonly repo: IHousingRepository) {}
  /** A host cancelling a confirmed stay must tell the guest why (FR-HOUSING-018 AC3). */
  async execute(
    handoffId: string,
    side: 'guest' | 'host',
    status: HousingHostBooking['status'],
    note?: string | null,
  ): Promise<void> {
    const reason = normalizedNote(note);
    if (side === 'host' && status === 'confirmed' && reason === null) {
      throw new HousingError('housing_cancel_reason_required', 'a host cancelling a confirmed stay gives a reason');
    }
    return this.repo.cancel(handoffId, reason);
  }
}

/** Runs a host action only inside the window the server allows (FR-HOUSING-019, 020). */
async function runHostAction(
  booking: HousingHostBooking,
  action: 'complete' | 'no_show',
  now: Date,
  run: () => Promise<void>,
): Promise<void> {
  if (!hostBookingActions(booking, now).includes(action)) {
    throw new HousingError('housing_not_in_window', `${action} is not available now`);
  }
  return run();
}

export class CompleteHousingStayUseCase {
  constructor(private readonly repo: IHousingRepository) {}
  execute(booking: HousingHostBooking, now: Date = new Date()): Promise<void> {
    return runHostAction(booking, 'complete', now, () => this.repo.complete(booking.handoffId));
  }
}

export class MarkHousingNoShowUseCase {
  constructor(private readonly repo: IHousingRepository) {}
  execute(booking: HousingHostBooking, now: Date = new Date()): Promise<void> {
    return runHostAction(booking, 'no_show', now, () => this.repo.markNoShow(booking.handoffId));
  }
}

export class ListHousingOfferBookingsUseCase {
  constructor(private readonly repo: IHousingRepository) {}
  execute(listingId: string): Promise<HousingHostBooking[]> {
    return this.repo.listForOffer(listingId);
  }
}

export class ListMyHousingStaysUseCase {
  constructor(private readonly repo: IHousingRepository) {}
  execute(limit?: number): Promise<HousingGuestStay[]> {
    return this.repo.listMyStays(limit);
  }
}
