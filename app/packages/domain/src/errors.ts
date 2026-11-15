/**
 * Domain error hierarchy. Domain code MUST throw a subclass of `DomainError`
 * rather than raw `Error` — the rule lives in `.cursor/rules/srs-architecture.mdc`
 * and is enforced by `app/scripts/check-architecture.mjs` (`pnpm lint:arch`).
 *
 * Subclasses declare a stable `code` for machine-readable handling at the UI
 * layer (e.g. mapping to a localized toast). Domain code never produces
 * user-facing copy: translation happens in `apps/mobile/src/i18n/locales/he/`.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * A domain function received input that violates an invariant — missing
 * required field, malformed value, out-of-range, etc. The optional `field`
 * lets the UI focus the offending input.
 */
export class ValidationError extends DomainError {
  readonly code = 'validation';

  constructor(message: string, public readonly field?: string) {
    super(message, field ? { field } : undefined);
  }
}

/** What a missing backend object is: a Postgres function, a table or view, a column, an Edge Function or a storage bucket. */
export type BackendObjectKind = 'function' | 'relation' | 'column' | 'edge_function' | 'bucket';

/**
 * The backend does not provide the object this call needs: a function, table, Edge Function
 * or bucket that does not exist, or one the caller has no grant on, in the deployed database.
 * It is the single signal of the degrade rule (docs/db/app-migration-playbook.md): an adapter
 * throws it, a list screen answers with its empty state, an action with the generic
 * "not available yet" message, and a world whose flag is off never reaches the call.
 * `object` names what was missing (for logs only; never shown to the member).
 */
export class BackendUnavailableError extends DomainError {
  readonly code = 'backend_unavailable';

  constructor(
    public readonly object: string,
    public readonly kind: BackendObjectKind = 'function',
    public readonly cause?: unknown,
  ) {
    super(`backend object not available: ${object}`, { object, kind });
  }
}

/**
 * A baseline RPC refused the call with a stable reason (`P0001` + a snake_case message, or
 * `42501` + `unauthenticated`). `reason` is that message, the only thing the application maps
 * on; `object` is the function that refused (`rpc:<name>`), for logs.
 */
export class BackendRuleError extends DomainError {
  readonly code = 'backend_rule';

  constructor(
    public readonly reason: string,
    public readonly object: string,
    public readonly cause?: unknown,
  ) {
    super(reason, { reason, object });
  }
}
