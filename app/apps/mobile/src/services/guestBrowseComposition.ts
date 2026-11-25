import {
  GetGuestProfileUseCase,
  ListGuestMapPinsUseCase,
  ListGuestProfilePostsUseCase,
} from '@kc/application';
import {
  SupabaseGuestMapRepository,
  SupabaseGuestProfileRepository,
} from '@kc/infrastructure-supabase';
import { supabase } from '../lib/container';

const mapRepo = new SupabaseGuestMapRepository(supabase);
const profileRepo = new SupabaseGuestProfileRepository(supabase);

export const listGuestMapPins = new ListGuestMapPinsUseCase(mapRepo);
export const getGuestProfile = new GetGuestProfileUseCase(profileRepo);
export const listGuestProfilePosts = new ListGuestProfilePostsUseCase(profileRepo);
