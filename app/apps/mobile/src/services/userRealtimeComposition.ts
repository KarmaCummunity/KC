// Composition root for IUserRealtime — wires SupabaseUserRealtime into the app.
// Mirrors userComposition.ts singleton pattern. FR-KARMA-009.
import {
  getSupabaseClient,
  SupabaseUserRealtime,
} from '@kc/infrastructure-supabase';
import type { IUserRealtime } from '@kc/application';
import { pickAuthStorage } from './authSecureStorage';

let instance: IUserRealtime | null = null;

export function getUserRealtime(): IUserRealtime {
  if (!instance) {
    instance = new SupabaseUserRealtime(getSupabaseClient({ storage: pickAuthStorage() }));
  }
  return instance;
}
