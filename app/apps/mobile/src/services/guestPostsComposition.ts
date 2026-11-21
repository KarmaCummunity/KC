import { SupabaseGuestPostsRepository } from '@kc/infrastructure-supabase';
import { supabase } from '../lib/container';
import { viaApi } from './backend/apiBackend';

export const guestPosts = viaApi('guestPosts', new SupabaseGuestPostsRepository(supabase));
