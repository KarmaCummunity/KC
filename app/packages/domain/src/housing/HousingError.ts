// Housing errors raised before a request reaches the server. Codes equal the server's
// (migrations 0600–0603), so one copy table translates both (`marketplace.errors.*`).
import { DomainError } from '../errors';

export type HousingErrorCode =
  | 'housing_dates_invalid'
  | 'housing_nights_out_of_range'
  | 'housing_capacity_exceeded'
  | 'housing_policy_mismatch'
  | 'housing_minor_unaccompanied'
  | 'housing_message_required'
  | 'housing_note_too_long'
  | 'housing_cancel_reason_required'
  | 'housing_not_in_window'
  | 'invalid_status';

export class HousingError extends DomainError {
  readonly code: HousingErrorCode;

  /** The message starts with the code so the UI error mapper (mapMarketplaceServerError) finds it. */
  constructor(code: HousingErrorCode, message: string) {
    super(`${code}: ${message}`, { code });
    this.code = code;
  }
}
