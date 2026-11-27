import { SupabaseGuestPostsRepository } from '@kc/infrastructure-supabase';
import { supabase } from '../lib/container';

export const guestPosts = new SupabaseGuestPostsRepository(supabase);
