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
