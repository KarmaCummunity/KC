// supabase/functions/_shared/post-extraction/providerTypes.ts
// Types of the extraction provider seam (FR-IMPORT-009 AC2, ADR-008), apart from the factory so
// the adapter and the factory do not import each other.

import type { ExtractionLists } from './domain/validateExtraction.ts';

export interface ExtractionProviderInput {
  /** Scrubbed, normalized text: the only form of the message a provider may receive. */
  text: string;
  /** When the message was sent, ISO with the Israel offset; null when unknown. */
  messageAtIso: string | null;
  lists: ExtractionLists;
}

export interface ExtractionProviderResult {
  /** The model's JSON, parsed but NOT yet validated against the contract. */
  raw: unknown;
  /** Model id stored as provenance. */
  model: string;
}

export interface PostExtractionProvider {
  extract(input: ExtractionProviderInput): Promise<ExtractionProviderResult>;
}

/** The provider could not give a usable answer: the caller falls back to the manual route (FR-IMPORT-006 AC4). */
export class ExtractionProviderError extends Error {
  constructor(public readonly kind: 'not_configured' | 'http' | 'timeout' | 'bad_response', message: string) {
    super(message);
    this.name = 'ExtractionProviderError';
  }
}
