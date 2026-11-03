import { DomainError } from '../errors';

export const GIVING_HANDOFF_STATUSES = [
  'reserved',
  'confirmed',
  'handed_over',
  'cancelled',
  'no_show',
] as const;
export type GivingHandoffStatus = (typeof GIVING_HANDOFF_STATUSES)[number];

export const GIVING_HANDOFF_PICKUP_MODES = ['pickup', 'delivery'] as const;
export type GivingHandoffPickupMode = (typeof GIVING_HANDOFF_PICKUP_MODES)[number];

export type GivingHandoffRole = 'owner' | 'recipient';

export class GivingHandoffError extends DomainError {
  readonly code: string;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.code = code;
  }
}

export function isGivingHandoffStatus(value: unknown): value is GivingHandoffStatus {
  return typeof value === 'string' && (GIVING_HANDOFF_STATUSES as readonly string[]).includes(value);
}

export function isValidPickupMode(value: unknown): value is GivingHandoffPickupMode {
  return typeof value === 'string' && (GIVING_HANDOFF_PICKUP_MODES as readonly string[]).includes(value);
}

export function isValidHandoffRating(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

export const HANDOFF_RATING_MAX_NOTE_LENGTH = 300;

/**
 * Checks whether a state transition is permitted for a giving handoff.
 * - 'reserved' -> 'confirmed' (owner only: selects recipient)
 * - 'reserved' -> 'cancelled' (owner or recipient can cancel/decline)
 * - 'confirmed' -> 'handed_over' (owner or recipient: completion)
 * - 'confirmed' -> 'cancelled' (owner or recipient can cancel)
 * Terminal states: 'handed_over', 'cancelled', 'no_show' cannot transition further.
 */
export function canTransitionGivingHandoff(
  from: GivingHandoffStatus,
  to: GivingHandoffStatus,
  role?: GivingHandoffRole,
): boolean {
  if (from === to) return false;

  if (from === 'reserved') {
    if (to === 'confirmed') return role === undefined || role === 'owner';
    if (to === 'cancelled') return true;
    return false;
  }

  if (from === 'confirmed') {
    if (to === 'handed_over' || to === 'cancelled') return true;
    return false;
  }

  return false;
}

/**
 * Validates a state transition and throws a domain GivingHandoffError if invalid.
 */
export function validateGivingHandoffTransition(
  from: GivingHandoffStatus,
  to: GivingHandoffStatus,
  role?: GivingHandoffRole,
): void {
  if (from === 'handed_over' || from === 'cancelled' || from === 'no_show') {
    throw new GivingHandoffError('invalid_status', `Cannot transition from terminal status ${from} to ${to}`);
  }

  if (from === 'reserved') {
    if (to === 'handed_over') {
      throw new GivingHandoffError(
        'handoff_not_confirmed',
        'Cannot complete a handoff that has not been confirmed by the owner',
      );
    }
    if (to === 'confirmed' && role === 'recipient') {
      throw new GivingHandoffError('owner_only', 'Only the listing owner can select/confirm the recipient');
    }
    if (to !== 'confirmed' && to !== 'cancelled') {
      throw new GivingHandoffError('invalid_status', `Invalid transition from reserved to ${to}`);
    }
    return;
  }

  if (from === 'confirmed') {
    if (to !== 'handed_over' && to !== 'cancelled') {
      throw new GivingHandoffError('invalid_status', `Invalid transition from confirmed to ${to}`);
    }
    return;
  }

  throw new GivingHandoffError('invalid_status', `Unsupported transition from ${from} to ${to}`);
}

/**
 * Validates rating recording on a completed handoff.
 */
export function validateHandoffFeedback(
  status: GivingHandoffStatus,
  rating: number,
  comment?: string | null,
): void {
  if (status !== 'handed_over') {
    throw new GivingHandoffError(
      'invalid_status',
      'Feedback can only be recorded for a completed (handed_over) handoff',
    );
  }
  if (!isValidHandoffRating(rating)) {
    throw new GivingHandoffError('invalid_rating', 'Rating must be an integer between 1 and 5');
  }
  if (comment != null && comment.trim().length > HANDOFF_RATING_MAX_NOTE_LENGTH) {
    throw new GivingHandoffError(
      'comment_too_long',
      `Feedback comment must not exceed ${HANDOFF_RATING_MAX_NOTE_LENGTH} characters`,
    );
  }
}
