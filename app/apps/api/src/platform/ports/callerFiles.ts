import type { CallerIdentity } from '../identity/callerIdentity';
import type { InProcessStorage } from '../postgrest/sqlBackedClient';

/**
 * File storage for the hosted adapters: the `storage` member of the
 * Supabase-shaped client, answered by this server's own store as the caller
 * (ADR-012 section 5). Provided by the storage module; a server without that
 * module, or without a store, has none.
 */
export interface CallerFiles {
  /** True when this server has a file store to answer with. */
  readonly available: boolean;
  /** The storage member acting as `caller`, or null when there is no store. */
  forCaller(caller: CallerIdentity | null): InProcessStorage | null;
}

/** Injection token of the server's `CallerFiles`. */
export const CALLER_FILES = Symbol('CALLER_FILES');
