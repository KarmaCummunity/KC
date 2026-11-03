// Composition root for ILegalDocumentRepository — FR-SETTINGS-010 server-driven legal docs.
// Singletons, lazy-instantiated. AsyncStorage backs the offline content cache.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getSupabaseClient,
  SupabaseLegalDocumentRepository,
  LegalDocumentCache,
  type AsyncKVStorage,
} from '@kc/infrastructure-supabase';
import {
  LoadLegalDocumentUseCase,
  CheckPendingLegalAcksUseCase,
  AcceptLegalDocumentUseCase,
  type ILegalDocumentRepository,
} from '@kc/application';
import { pickAuthStorage } from './authSecureStorage';

let _repo: ILegalDocumentRepository | null = null;
let _load: LoadLegalDocumentUseCase | null = null;
let _check: CheckPendingLegalAcksUseCase | null = null;
let _accept: AcceptLegalDocumentUseCase | null = null;

// react-native AsyncStorage already implements the AsyncKVStorage shape we
// need for the legal cache (getItem / setItem / removeItem returning promises).
const legalCacheStorage: AsyncKVStorage = AsyncStorage;

function getRepo(): ILegalDocumentRepository {
  if (_repo) return _repo;
  const cache = new LegalDocumentCache(legalCacheStorage);
  _repo = new SupabaseLegalDocumentRepository(
    getSupabaseClient({ storage: pickAuthStorage() }),
    cache,
  );
  return _repo;
}

export function getLoadLegalDocumentUseCase(): LoadLegalDocumentUseCase {
  _load ??= new LoadLegalDocumentUseCase(getRepo());
  return _load;
}

export function getCheckPendingLegalAcksUseCase(): CheckPendingLegalAcksUseCase {
  _check ??= new CheckPendingLegalAcksUseCase(getRepo());
  return _check;
}

export function getAcceptLegalDocumentUseCase(): AcceptLegalDocumentUseCase {
  _accept ??= new AcceptLegalDocumentUseCase(getRepo());
  return _accept;
}
