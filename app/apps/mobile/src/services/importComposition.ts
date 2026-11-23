// ─────────────────────────────────────────────
// Composition root for the external post import — mirrors postsComposition.ts.
// Mapped to spec: FR-IMPORT-001..010 (ADR-008).
// ─────────────────────────────────────────────

import { EdgeFnPostExtractionService, SupabaseImportTelemetryRepository, getSupabaseClient } from '@kc/infrastructure-supabase';
import {
  AttachImportedPostUseCase,
  ExtractExternalPostUseCase,
  GetImportTelemetryUseCase,
  type IPostExtractionService,
} from '@kc/application';
import { pickAuthStorage } from './authSecureStorage';
import { viaApi } from './backend/apiBackend';

let _service: IPostExtractionService | undefined;
let _extractExternalPost: ExtractExternalPostUseCase | undefined;
let _attachImportedPost: AttachImportedPostUseCase | undefined;
let _importTelemetry: GetImportTelemetryUseCase | undefined;

function service(): IPostExtractionService {
  _service ??= viaApi('postExtraction', new EdgeFnPostExtractionService(getSupabaseClient({ storage: pickAuthStorage() })));
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

/** FR-IMPORT-010 AC4 — the import funnel and the per-field edit rate (admin statistics). */
export function getImportTelemetryUseCase(): GetImportTelemetryUseCase {
  _importTelemetry ??= new GetImportTelemetryUseCase(
    viaApi('importTelemetry', new SupabaseImportTelemetryRepository(getSupabaseClient({ storage: pickAuthStorage() }))),
  );
  return _importTelemetry;
}
