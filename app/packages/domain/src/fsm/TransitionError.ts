import { DomainError } from '../errors';

/**
 * Why a move was refused. The same three codes are raised (as the exception message,
 * SQLSTATE `P0001`) by `public.fsm_assert_transition` in Postgres.
 * - `unknown_state`: `from` or `to` is not a state of the machine.
 * - `illegal_transition`: both states exist, they differ, and no edge connects them.
 * - `forbidden_role`: the edge exists but is restricted to roles the caller does not hold.
 */
export type TransitionErrorCode = 'unknown_state' | 'illegal_transition' | 'forbidden_role';

/** Context for logs and telemetry. Screens translate `code`, never the message. */
export type TransitionErrorDetails = {
  readonly machine: string;
  readonly from: string;
  readonly to: string;
  readonly role?: string;
};

/** Thrown by `assertTransition`; the message is the machine-readable `code`. */
export class TransitionError extends DomainError {
  readonly code: TransitionErrorCode;

  constructor(code: TransitionErrorCode, details: TransitionErrorDetails) {
    super(code, details);
    this.code = code;
  }
}
