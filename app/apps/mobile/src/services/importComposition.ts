// ─────────────────────────────────────────────
// Composition root for the external post import — mirrors postsComposition.ts.
// Mapped to spec: FR-IMPORT-001..009 (ADR-008).
// ─────────────────────────────────────────────

import { EdgeFnPostExtractionService, getSupabaseClient } from '@kc/infrastructure-supabase';
import { ExtractExternalPostUseCase } from '@kc/application';
import { pickAuthStorage } from './authSecureStorage';

let _extractExternalPost: ExtractExternalPostUseCase | undefined;

/** The use case that turns a shared or pasted text into a reviewable draft. */
export function extractExternalPostUseCase(): ExtractExternalPostUseCase {
  if (!_extractExternalPost) {
    _extractExternalPost = new ExtractExternalPostUseCase(
      new EdgeFnPostExtractionService(getSupabaseClient({ storage: pickAuthStorage() })),
    );
  }
  return _extractExternalPost;
}
