// The seam between KC's import rules and the model that reads a shared message
// (FR-IMPORT-009 AC2, ADR-008). Swapping the model (the free tier for one under
// a data-processing agreement) is configuration, never a code change.

import type { ExtractionLists } from '@kc/domain';

export interface ExtractionProviderInput {
  /** Scrubbed, normalized text: the only form of the message a provider may receive. */
  readonly text: string;
  /** When the message was sent, ISO with the Israel offset; null when unknown. */
  readonly messageAtIso: string | null;
  /** The closed lists the answer must choose from. */
  readonly lists: ExtractionLists;
}

export interface ExtractionProviderResult {
  /** The model's JSON, parsed but NOT yet validated against the contract. */
  readonly raw: unknown;
  /** Model id, stored as provenance. */
  readonly model: string;
}

export interface PostExtractionProvider {
  /** Rejects when the provider gave no answer; the pipeline then falls back to the manual route (FR-IMPORT-006 AC4). */
  extract(input: ExtractionProviderInput): Promise<ExtractionProviderResult>;
}

/** Injection token of the configured `PostExtractionProvider` (replaced in tests, so none reaches the network). */
export const POST_EXTRACTION_PROVIDER = Symbol('POST_EXTRACTION_PROVIDER');
