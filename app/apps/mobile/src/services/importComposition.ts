// ─────────────────────────────────────────────
// Composition root for the external post import — mirrors postsComposition.ts.
// Mapped to spec: FR-IMPORT-001..009 (ADR-008).
// ─────────────────────────────────────────────

import { EdgeFnPostExtractionService, getSupabaseClient } from '@kc/infrastructure-supabase';
import { AttachImportedPostUseCase, ExtractExternalPostUseCase, type IPostExtractionService } from '@kc/application';
import { pickAuthStorage } from './authSecureStorage';

let _service: IPostExtractionService | undefined;
let _extractExternalPost: ExtractExternalPostUseCase | undefined;
let _attachImportedPost: AttachImportedPostUseCase | undefined;

function service(): IPostExtractionService {
  _service ??= new EdgeFnPostExtractionService(getSupabaseClient({ storage: pickAuthStorage() }));
  return _service;
}

/** The use case that turns a shared or pasted text into a reviewable draft. */
export function extractExternalPostUseCase(): ExtractExternalPostUseCase {
  if (!_extractExternalPost) {
    _extractExternalPost = new ExtractExternalPostUseCase(service());
  }
  return _extractExternalPost;
}

/** The use case that marks a just published post as imported from the member's import. */
export function attachImportedPostUseCase(): AttachImportedPostUseCase {
  _attachImportedPost ??= new AttachImportedPostUseCase(service());
  return _attachImportedPost;
}
