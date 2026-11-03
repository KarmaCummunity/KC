// FR-POST-022 — composition root for ISavedPostsRepository.
import {
  getSupabaseClient,
  SupabaseSavedPostsRepository,
} from '@kc/infrastructure-supabase';
import {
  SavePostUseCase,
  UnsavePostUseCase,
  IsPostSavedUseCase,
  ListSavedPostsUseCase,
  type ISavedPostsRepository,
} from '@kc/application';
import { pickAuthStorage } from './authSecureStorage';

let _repo: ISavedPostsRepository | null = null;
let _savePost: SavePostUseCase | null = null;
let _unsavePost: UnsavePostUseCase | null = null;
let _isPostSaved: IsPostSavedUseCase | null = null;
let _listSavedPosts: ListSavedPostsUseCase | null = null;

function getRepo(): ISavedPostsRepository {
  if (_repo) return _repo;
  _repo = new SupabaseSavedPostsRepository(getSupabaseClient({ storage: pickAuthStorage() }));
  return _repo;
}

export function getSavePostUseCase(): SavePostUseCase {
  _savePost ??= new SavePostUseCase(getRepo());
  return _savePost;
}

export function getUnsavePostUseCase(): UnsavePostUseCase {
  _unsavePost ??= new UnsavePostUseCase(getRepo());
  return _unsavePost;
}

export function getIsPostSavedUseCase(): IsPostSavedUseCase {
  _isPostSaved ??= new IsPostSavedUseCase(getRepo());
  return _isPostSaved;
}

export function getListSavedPostsUseCase(): ListSavedPostsUseCase {
  _listSavedPosts ??= new ListSavedPostsUseCase(getRepo());
  return _listSavedPosts;
}
