// Composition root for IAboutRepository — About landing team roster.

import {
  getSupabaseClient,
  SupabaseAboutRepository,
} from '@kc/infrastructure-supabase';
import { ListAboutTeamMembersUseCase, type IAboutRepository } from '@kc/application';
import { pickAuthStorage } from './authSecureStorage';

let _about: IAboutRepository | null = null;
let _listTeamMembers: ListAboutTeamMembersUseCase | null = null;

function getAboutRepo(): IAboutRepository {
  if (_about) return _about;
  _about = new SupabaseAboutRepository(getSupabaseClient({ storage: pickAuthStorage() }));
  return _about;
}

export function getListAboutTeamMembersUseCase(): ListAboutTeamMembersUseCase {
  if (!_listTeamMembers) {
    _listTeamMembers = new ListAboutTeamMembersUseCase(getAboutRepo());
  }
  return _listTeamMembers;
}
