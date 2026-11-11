import type { IMarketplaceRepository } from '../ports/IMarketplaceRepository';
import {
  GivingHandoffError,
  isValidPickupMode,
  isValidHandoffRating,
  HANDOFF_RATING_MAX_NOTE_LENGTH,
  type GivingHandoffSnapshot,
  type MyGivingHandoffRow,
  type GivingHandoffPickupMode,
} from '@kc/domain';

export class GetListingHandoffUseCase {
  constructor(private readonly repo: IMarketplaceRepository) {}
  async execute(listingId: string) {
    if (!listingId || !listingId.trim()) return null;
    return this.repo.getListingHandoff(listingId);
  }
}

export class ListMyGivingHandoffsUseCase {
  constructor(private readonly repo: IMarketplaceRepository) {}
  async execute(limit?: number): Promise<MyGivingHandoffRow[]> {
    return this.repo.listMyGivingHandoffs(limit);
  }
}

export class ReserveItemGivingUseCase {
  constructor(private readonly repo: IMarketplaceRepository) {}
  async execute(
    listingId: string,
    pickupMode?: GivingHandoffPickupMode,
    pickupWindowStart?: string | null,
    pickupWindowEnd?: string | null,
    idempotencyKey?: string | null,
  ): Promise<GivingHandoffSnapshot> {
    if (!listingId || !listingId.trim()) {
      throw new GivingHandoffError('listing_not_available', 'Listing ID is required');
    }
    if (pickupMode !== undefined && !isValidPickupMode(pickupMode)) {
      throw new GivingHandoffError('invalid_pickup_mode', 'Invalid pickup mode');
    }
    if (idempotencyKey !== undefined) {
      return this.repo.reserveItemGiving(listingId, pickupMode, pickupWindowStart, pickupWindowEnd, idempotencyKey);
    }
    return this.repo.reserveItemGiving(listingId, pickupMode, pickupWindowStart, pickupWindowEnd);
  }
}

export class ConfirmItemHandoffUseCase {
  constructor(private readonly repo: IMarketplaceRepository) {}
  async execute(handoffId: string): Promise<GivingHandoffSnapshot> {
    if (!handoffId || !handoffId.trim()) {
      throw new GivingHandoffError('handoff_not_found', 'Handoff ID is required');
    }
    return this.repo.confirmItemHandoff(handoffId);
  }
}

export class ClaimFoodGivingUseCase {
  constructor(private readonly repo: IMarketplaceRepository) {}
  async execute(
    listingId: string,
    pickupWindowStart?: string | null,
    pickupWindowEnd?: string | null,
    idempotencyKey?: string | null,
  ): Promise<GivingHandoffSnapshot> {
    if (!listingId || !listingId.trim()) {
      throw new GivingHandoffError('listing_not_available', 'Listing ID is required');
    }
    if (idempotencyKey !== undefined) {
      return this.repo.claimFoodGiving(listingId, pickupWindowStart, pickupWindowEnd, idempotencyKey);
    }
    return this.repo.claimFoodGiving(listingId, pickupWindowStart, pickupWindowEnd);
  }
}

export class CancelGivingHandoffUseCase {
  constructor(private readonly repo: IMarketplaceRepository) {}
  async execute(handoffId: string): Promise<void> {
    if (!handoffId || !handoffId.trim()) {
      throw new GivingHandoffError('handoff_not_found', 'Handoff ID is required');
    }
    await this.repo.cancelGivingHandoff(handoffId);
  }
}

export class MarkGivingHandedOverUseCase {
  constructor(private readonly repo: IMarketplaceRepository) {}
  async execute(handoffId: string): Promise<GivingHandoffSnapshot> {
    if (!handoffId || !handoffId.trim()) {
      throw new GivingHandoffError('handoff_not_found', 'Handoff ID is required');
    }
    return this.repo.markGivingHandedOver(handoffId);
  }
}

export class RateGivingHandoffUseCase {
  constructor(private readonly repo: IMarketplaceRepository) {}
  async execute(handoffId: string, rating: number, comment?: string | null): Promise<void> {
    if (!handoffId || !handoffId.trim()) {
      throw new GivingHandoffError('handoff_not_found', 'Handoff ID is required');
    }
    if (!isValidHandoffRating(rating)) {
      throw new GivingHandoffError('invalid_rating', 'Rating must be an integer between 1 and 5');
    }
    if (comment != null && comment.trim().length > HANDOFF_RATING_MAX_NOTE_LENGTH) {
      throw new GivingHandoffError('comment_too_long', 'Comment exceeds maximum allowed length');
    }
    await this.repo.rateGivingHandoff(handoffId, rating, comment);
  }
}
