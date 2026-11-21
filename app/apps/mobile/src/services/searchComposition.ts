// ─────────────────────────────────────────────
// Composition root for ISearchRepository — mirrors postsComposition.ts.
// Mapped to SRS: FR-FEED-017+ (universal search engine).
// ─────────────────────────────────────────────

import {
  getSupabaseClient,
  SupabaseSearchRepository,
} from '@kc/infrastructure-supabase';
import {
  UniversalSearchUseCase,
  type ISearchRepository,
} from '@kc/application';
import { pickAuthStorage } from './authSecureStorage';
import { viaApi } from './backend/apiBackend';

let _repo: ISearchRepository | null = null;
let _search: UniversalSearchUseCase | null = null;

function getRepo(): ISearchRepository {
  if (_repo) return _repo;
  _repo = viaApi('search', new SupabaseSearchRepository(getSupabaseClient({ storage: pickAuthStorage() })));
  return _repo;
}

export function getUniversalSearchUseCase(): UniversalSearchUseCase {
  _search ??= new UniversalSearchUseCase(getRepo());
  return _search;
}
