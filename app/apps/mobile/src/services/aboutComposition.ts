// Composition root for IAboutRepository — About landing team roster.

import { getSupabaseClient, SupabaseAboutRepository } from '@kc/infrastructure-supabase';
import { pickAuthStorage } from './authSecureStorage';
import { ListAboutTeamMembersUseCase, type IAboutRepository } from '@kc/application';
import { viaApi } from './backend/apiBackend';

let _about: IAboutRepository | null = null;
let _listTeamMembers: ListAboutTeamMembersUseCase | null = null;

function getAboutRepo(): IAboutRepository {
  if (_about) return _about;
  _about = viaApi('about', new SupabaseAboutRepository(getSupabaseClient({ storage: pickAuthStorage() })));
  return _about;
}

export function getListAboutTeamMembersUseCase(): ListAboutTeamMembersUseCase {
  if (!_listTeamMembers) {
    _listTeamMembers = new ListAboutTeamMembersUseCase(getAboutRepo());
  }
  return _listTeamMembers;
}
