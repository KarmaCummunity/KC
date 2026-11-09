import { DomainError } from '../errors';

export type TransitionErrorCode = 'unknown_state' | 'illegal_transition' | 'forbidden_role';

export class TransitionError extends DomainError {
  readonly code: TransitionErrorCode;

  constructor(
    code: TransitionErrorCode,
    details: { machine: string; from: string; to: string; role?: string },
  ) {
    super(code, details);
    this.code = code;
  }
}
